// Cadena de voz local con Audio Units de Apple (sin FFmpeg ni servicios externos).
// Uso: kiko-cadena-voz entrada salida.wav
// Aislamiento moderado -> paso alto 80 Hz -> EQ -> de-esser multibanda -> compresor -> limitador.
import AVFoundation
import AudioToolbox
import Foundation

func appleEffect(_ subtype: OSType) -> AVAudioUnitEffect {
    AVAudioUnitEffect(audioComponentDescription: AudioComponentDescription(
        componentType: kAudioUnitType_Effect, componentSubType: subtype,
        componentManufacturer: kAudioUnitManufacturer_Apple, componentFlags: 0, componentFlagsMask: 0))
}

func setParameter(_ unit: AVAudioUnit, _ id: AudioUnitParameterID, _ value: AudioUnitParameterValue) {
    AudioUnitSetParameter(unit.audioUnit, id, kAudioUnitScope_Global, 0, value, 0)
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(2)
}

let arguments = CommandLine.arguments
guard arguments.count == 3 || arguments.count == 4 else { fail("Uso: kiko-cadena-voz entrada salida.wav [aislamiento 0-100]") }
// El porcentaje de aislamiento viene de la skill «Sonido» (65 por defecto).
let aislamiento = arguments.count == 4 ? max(0, min(100, Float(arguments[3]) ?? 65)) : 65

do {
    let input = try AVAudioFile(forReading: URL(fileURLWithPath: arguments[1]))
    let format = input.processingFormat
    let engine = AVAudioEngine()
    let player = AVAudioPlayerNode()

    // Aislamiento de voz (65 % por defecto): reduce ruido unos 9 dB sin el timbre metálico del 100 %.
    let isolation = appleEffect(0x766F6973) // 'vois'
    setParameter(isolation, 0, aislamiento)
    setParameter(isolation, 1, 0) // High Quality Voice

    let eq = AVAudioUnitEQ(numberOfBands: 3)
    eq.bands[0].filterType = .highPass
    eq.bands[0].frequency = 80
    eq.bands[1].filterType = .parametric
    eq.bands[1].frequency = 300
    eq.bands[1].bandwidth = 1.0
    eq.bands[1].gain = -2
    eq.bands[2].filterType = .parametric
    eq.bands[2].frequency = 4000
    eq.bands[2].bandwidth = 1.5
    eq.bands[2].gain = 2
    eq.bands.forEach { $0.bypass = false }

    // De-esser: solo la banda alta (> 6,5 kHz) comprime; las otras tres quedan sin tocar.
    let deesser = appleEffect(kAudioUnitSubType_MultiBandCompressor)
    setParameter(deesser, 2, 120)
    setParameter(deesser, 3, 700)
    setParameter(deesser, 4, 6500)
    for threshold: AudioUnitParameterID in 5...7 { setParameter(deesser, threshold, 0) }
    setParameter(deesser, 8, -32)
    setParameter(deesser, 12, 6)
    setParameter(deesser, 13, 0.005)
    setParameter(deesser, 14, 0.08)

    // Compresor aproximado a 3:1 desde -18 dB.
    let compressor = appleEffect(kAudioUnitSubType_DynamicsProcessor)
    setParameter(compressor, 0, -18)
    setParameter(compressor, 1, 6)
    setParameter(compressor, 4, 0.010)
    setParameter(compressor, 5, 0.120)

    let limiter = appleEffect(kAudioUnitSubType_PeakLimiter)
    setParameter(limiter, 0, 0.002)
    setParameter(limiter, 1, 0.010)

    let chain: [AVAudioNode] = [player, isolation, eq, deesser, compressor, limiter, engine.mainMixerNode]
    chain.forEach { if $0 !== engine.mainMixerNode { engine.attach($0) } }
    for (source, target) in zip(chain, chain.dropFirst()) { engine.connect(source, to: target, format: format) }

    try engine.enableManualRenderingMode(.offline, format: format, maximumFrameCount: 4096)
    try engine.start()
    player.scheduleFile(input, at: nil)
    player.play()

    // La latencia de los efectos retrasaría la voz frente a las marcas por palabra; se recorta al inicio.
    let latency = [isolation, eq, deesser, compressor, limiter].map { $0.auAudioUnit.latency }.reduce(0, +)
    var framesToSkip = AVAudioFramePosition((latency * format.sampleRate).rounded())
    let totalFrames = input.length + framesToSkip
    let settings: [String: Any] = [
        AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: format.sampleRate,
        AVNumberOfChannelsKey: format.channelCount, AVLinearPCMBitDepthKey: 24,
        AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false,
    ]
    let output = try AVAudioFile(forWriting: URL(fileURLWithPath: arguments[2]), settings: settings,
                                 commonFormat: .pcmFormatFloat32, interleaved: false)
    guard let buffer = AVAudioPCMBuffer(pcmFormat: engine.manualRenderingFormat,
                                        frameCapacity: engine.manualRenderingMaximumFrameCount) else { fail("Sin búfer de render") }
    while engine.manualRenderingSampleTime < totalFrames {
        let remaining = totalFrames - engine.manualRenderingSampleTime
        let frames = AVAudioFrameCount(min(AVAudioFramePosition(buffer.frameCapacity), remaining))
        guard try engine.renderOffline(frames, to: buffer) == .success else { fail("El render offline se detuvo") }
        let skip = AVAudioFrameCount(min(AVAudioFramePosition(buffer.frameLength), framesToSkip))
        framesToSkip -= AVAudioFramePosition(skip)
        if skip == buffer.frameLength { continue }
        if skip > 0 {
            guard let slice = AVAudioPCMBuffer(pcmFormat: buffer.format, frameCapacity: buffer.frameLength - skip) else { fail("Sin búfer") }
            slice.frameLength = buffer.frameLength - skip
            for channel in 0..<Int(buffer.format.channelCount) {
                slice.floatChannelData![channel].update(from: buffer.floatChannelData![channel] + Int(skip), count: Int(slice.frameLength))
            }
            try output.write(from: slice)
        } else {
            try output.write(from: buffer)
        }
    }
    player.stop()
    engine.stop()
    let payload: [String: Any] = [
        "ok": true, "latencia_s": latency, "canales": Int(format.channelCount),
        "frecuencia": format.sampleRate, "duracion_s": Double(input.length) / format.sampleRate,
    ]
    FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]))
    FileHandle.standardOutput.write(Data("\n".utf8))
} catch {
    fail(error.localizedDescription)
}

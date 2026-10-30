// Detecta rostros en instantes concretos de un video con Apple Vision (local).
// Uso: kiko-caras video.mp4 t1 t2 ...   → JSON [{"t": s, "caras": [[x, y, ancho, alto], ...]}] en píxeles, origen arriba a la izquierda.
import AVFoundation
import Foundation
import Vision

let arguments = CommandLine.arguments
guard arguments.count >= 3 else {
    FileHandle.standardError.write(Data("Uso: kiko-caras video t1 t2 ...\n".utf8))
    exit(2)
}

let asset = AVURLAsset(url: URL(fileURLWithPath: arguments[1]))
let generator = AVAssetImageGenerator(asset: asset)
generator.appliesPreferredTrackTransform = true
generator.requestedTimeToleranceBefore = .zero
generator.requestedTimeToleranceAfter = .zero

var resultados: [[String: Any]] = []
for valor in arguments.dropFirst(2) {
    guard let segundos = Double(valor) else { continue }
    var caras: [[Int]] = []
    if let imagen = try? generator.copyCGImage(at: CMTime(seconds: segundos, preferredTimescale: 600), actualTime: nil) {
        let solicitud = VNDetectFaceRectanglesRequest()
        try? VNImageRequestHandler(cgImage: imagen).perform([solicitud])
        let ancho = Double(imagen.width), alto = Double(imagen.height)
        for cara in solicitud.results ?? [] {
            let caja = cara.boundingBox
            caras.append([
                Int(caja.minX * ancho), Int((1 - caja.maxY) * alto),
                Int(caja.width * ancho), Int(caja.height * alto),
            ])
        }
    }
    resultados.append(["t": segundos, "caras": caras])
}
FileHandle.standardOutput.write(try! JSONSerialization.data(withJSONObject: resultados))
FileHandle.standardOutput.write(Data("\n".utf8))

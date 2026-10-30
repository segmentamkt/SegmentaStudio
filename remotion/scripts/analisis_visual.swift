// Mide cómo se ve una toma en varios instantes, en local: brillo, contraste, saturación, calidez del color,
// nitidez y dónde y qué tan grande aparece el rostro (Apple Vision). Lo usa el Director para recomendar skills.
// Uso: kiko-analisis-visual video.mov [muestras]  → JSON con los promedios.
import AVFoundation
import CoreGraphics
import Foundation
import Vision

let arguments = CommandLine.arguments
guard arguments.count >= 2 else {
    FileHandle.standardError.write(Data("Uso: kiko-analisis-visual video [muestras]\n".utf8))
    exit(2)
}
let muestras = arguments.count >= 3 ? max(1, Int(arguments[2]) ?? 5) : 5
let asset = AVURLAsset(url: URL(fileURLWithPath: arguments[1]))
let duracion = CMTimeGetSeconds(asset.duration)
let generador = AVAssetImageGenerator(asset: asset)
generador.appliesPreferredTrackTransform = true
generador.maximumSize = CGSize(width: 360, height: 640)

/// Píxeles RGBA de la imagen reducida a `ancho` × `alto`.
func pixeles(_ imagen: CGImage, _ ancho: Int, _ alto: Int) -> [UInt8] {
    var datos = [UInt8](repeating: 0, count: ancho * alto * 4)
    let contexto = CGContext(data: &datos, width: ancho, height: alto, bitsPerComponent: 8, bytesPerRow: ancho * 4,
                             space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    contexto.interpolationQuality = .medium
    contexto.draw(imagen, in: CGRect(x: 0, y: 0, width: ancho, height: alto))
    return datos
}

var brillo = 0.0, contraste = 0.0, saturacion = 0.0, calidez = 0.0, nitidez = 0.0
var conRostro = 0, tamanoRostro = 0.0, centroX = 0.0, centroY = 0.0, analizadas = 0, ancho = 0, alto = 0

for k in 1...muestras {
    let segundos = duracion * Double(k) / Double(muestras + 1)
    guard let imagen = try? generador.copyCGImage(at: CMTime(seconds: segundos, preferredTimescale: 600), actualTime: nil) else { continue }
    analizadas += 1
    ancho = imagen.width
    alto = imagen.height
    // Color y luz sobre una versión pequeña (basta para promedios).
    let w = 90, h = 160
    let p = pixeles(imagen, w, h)
    var lums = [Double](), sumaR = 0.0, sumaB = 0.0, sumaSat = 0.0
    for i in stride(from: 0, to: p.count, by: 4) {
        let r = Double(p[i]) / 255, g = Double(p[i + 1]) / 255, b = Double(p[i + 2]) / 255
        lums.append(0.2126 * r + 0.7152 * g + 0.0722 * b)
        sumaR += r
        sumaB += b
        let maximo = max(r, g, b), minimo = min(r, g, b)
        sumaSat += maximo > 0 ? (maximo - minimo) / maximo : 0
    }
    let n = Double(lums.count)
    let media = lums.reduce(0, +) / n
    brillo += media
    contraste += (lums.map { ($0 - media) * ($0 - media) }.reduce(0, +) / n).squareRoot()
    saturacion += sumaSat / n
    calidez += (sumaR - sumaB) / n
    // Nitidez: energía media del laplaciano de la luminancia a 180 × 320.
    let w2 = 180, h2 = 320
    let q = pixeles(imagen, w2, h2)
    var luma = [Double](repeating: 0, count: w2 * h2)
    for i in 0..<(w2 * h2) {
        luma[i] = (0.2126 * Double(q[i * 4]) + 0.7152 * Double(q[i * 4 + 1]) + 0.0722 * Double(q[i * 4 + 2])) / 255
    }
    var energia = 0.0
    for y in 1..<(h2 - 1) {
        for x in 1..<(w2 - 1) {
            let c = luma[y * w2 + x]
            let lap = 4 * c - luma[y * w2 + x - 1] - luma[y * w2 + x + 1] - luma[(y - 1) * w2 + x] - luma[(y + 1) * w2 + x]
            energia += abs(lap)
        }
    }
    nitidez += energia / Double((w2 - 2) * (h2 - 2))
    // Rostro más grande del cuadro.
    let solicitud = VNDetectFaceRectanglesRequest()
    try? VNImageRequestHandler(cgImage: imagen).perform([solicitud])
    if let cara = (solicitud.results ?? []).max(by: { $0.boundingBox.width * $0.boundingBox.height < $1.boundingBox.width * $1.boundingBox.height }) {
        let caja = cara.boundingBox
        conRostro += 1
        tamanoRostro += Double(caja.width * caja.height)
        centroX += Double(caja.midX)
        centroY += Double(1 - caja.midY)
    }
}

guard analizadas > 0 else {
    FileHandle.standardError.write(Data("No se pudo leer ningún fotograma\n".utf8))
    exit(1)
}
let a = Double(analizadas)
var resultado: [String: Any] = [
    "muestras": analizadas, "ancho": ancho, "alto": alto, "duracion": duracion,
    "brillo": brillo / a, "contraste": contraste / a, "saturacion": saturacion / a,
    "calidez": calidez / a, "nitidez": nitidez / a, "rostro_en": Double(conRostro) / a,
]
if conRostro > 0 {
    let c = Double(conRostro)
    resultado["rostro"] = ["tamano": tamanoRostro / c, "centro_x": centroX / c, "centro_y": centroY / c]
}
FileHandle.standardOutput.write(try! JSONSerialization.data(withJSONObject: resultado))
FileHandle.standardOutput.write(Data("\n".utf8))

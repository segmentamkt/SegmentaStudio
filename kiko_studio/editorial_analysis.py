"""Análisis editorial local de clips sin servicios externos.

Los metadatos y hojas de contacto usan AVFoundation/AppKit en macOS. La
transcripción se considera disponible solo cuando un backend local demuestra
estar listo; este módulo nunca usa nombres de archivo ni metadatos como si
fueran palabras pronunciadas.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import platform
import plistlib
import shutil
import subprocess
import tempfile
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping, Optional, Sequence, Union


class EditorialAnalysisError(RuntimeError):
    pass


class TranscriptionUnavailableError(EditorialAnalysisError):
    pass


@dataclass(frozen=True)
class MediaMetadata:
    path: str
    filename: str
    size_bytes: int
    modified_at: str
    created_at: Optional[str]
    duration_seconds: float
    width: int
    height: int
    orientation: str
    rotation_degrees: int
    has_audio: bool
    video_codec: Optional[str]
    audio_codec: Optional[str]
    nominal_fps: Optional[float]
    extraction_backend: str

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class ThumbnailResult:
    source_path: str
    output_path: str
    frame_count: int
    timestamps_seconds: tuple[float, ...]
    width: int
    height: int
    backend: str = "avfoundation"

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class TranscriptionAvailability:
    backend: str
    installed: bool
    ready: bool
    on_device: bool
    authorization: str
    reason: str
    executable: Optional[str] = None

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class TranscriptWord:
    start: float
    end: float
    text: str


@dataclass(frozen=True)
class TranscriptSegment:
    start: float
    end: float
    text: str
    confidence: Optional[float] = None
    words: tuple[TranscriptWord, ...] = ()


@dataclass(frozen=True)
class TranscriptResult:
    source_path: str
    backend: str
    language: Optional[str]
    text: str
    segments: tuple[TranscriptSegment, ...]
    locally_processed: bool = True

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class EditorialBrief:
    title: str
    source_basis: str
    transcript_status: str
    clips: tuple[Mapping[str, Any], ...]
    chronology: tuple[Mapping[str, Any], ...]
    script: tuple[Mapping[str, Any], ...]
    editorial_notes: tuple[str, ...] = field(default_factory=tuple)

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


_HELPER_SOURCE = r'''
#import <Foundation/Foundation.h>
#import <AVFoundation/AVFoundation.h>
#import <AppKit/AppKit.h>
#import <Speech/Speech.h>

static void Fail(NSString *message) {
    fprintf(stderr, "%s\n", message.UTF8String); exit(2);
}
static void Emit(id object) {
    NSError *error = nil;
    NSData *data = [NSJSONSerialization dataWithJSONObject:object options:NSJSONWritingSortedKeys error:&error];
    if (!data) Fail(error.localizedDescription ?: @"JSON error");
    printf("%s\n", [[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] UTF8String]);
}
static NSString *FourCC(CMFormatDescriptionRef description) {
    if (!description) return @"unknown";
    FourCharCode code = CMFormatDescriptionGetMediaSubType(description);
    char chars[5] = {(char)((code >> 24) & 255), (char)((code >> 16) & 255),
                     (char)((code >> 8) & 255), (char)(code & 255), 0};
    for (int i=0; i<4; i++) if (chars[i] < 32 || chars[i] > 126) chars[i] = '?';
    return [NSString stringWithUTF8String:chars];
}
static void Metadata(NSString *path) {
    AVURLAsset *asset = [AVURLAsset URLAssetWithURL:[NSURL fileURLWithPath:path] options:nil];
    AVAssetTrack *video = [[asset tracksWithMediaType:AVMediaTypeVideo] firstObject];
    if (!video) Fail(@"No video track");
    AVAssetTrack *audio = [[asset tracksWithMediaType:AVMediaTypeAudio] firstObject];
    CGRect rect = CGRectStandardize(CGRectApplyAffineTransform((CGRect){CGPointZero, video.naturalSize}, video.preferredTransform));
    double seconds = CMTimeGetSeconds(asset.duration);
    double degrees = atan2(video.preferredTransform.b, video.preferredTransform.a) * 180.0 / M_PI;
    CMFormatDescriptionRef vdesc = video.formatDescriptions.count ? (__bridge CMFormatDescriptionRef)video.formatDescriptions[0] : nil;
    CMFormatDescriptionRef adesc = audio.formatDescriptions.count ? (__bridge CMFormatDescriptionRef)audio.formatDescriptions[0] : nil;
    Emit(@{@"duration": @(isfinite(seconds) ? seconds : 0),
           @"width": @((NSInteger)llround(fabs(rect.size.width))),
           @"height": @((NSInteger)llround(fabs(rect.size.height))),
           @"rotation": @((NSInteger)llround(degrees)), @"fps": @(video.nominalFrameRate),
           @"has_audio": @(audio != nil), @"video_codec": FourCC(vdesc),
           @"audio_codec": audio ? FourCC(adesc) : [NSNull null]});
}
static void Contact(NSString *source, NSString *output, NSInteger columns, NSInteger rows, NSInteger maxWidth) {
    AVURLAsset *asset = [AVURLAsset URLAssetWithURL:[NSURL fileURLWithPath:source] options:nil];
    AVAssetTrack *video = [[asset tracksWithMediaType:AVMediaTypeVideo] firstObject];
    if (!video) Fail(@"No video track");
    double duration = CMTimeGetSeconds(asset.duration);
    if (!isfinite(duration) || duration <= 0) Fail(@"Invalid duration");
    NSInteger count = columns * rows;
    AVAssetImageGenerator *generator = [[AVAssetImageGenerator alloc] initWithAsset:asset];
    generator.appliesPreferredTrackTransform = YES;
    NSMutableArray *images = [NSMutableArray array];
    NSMutableArray *timestamps = [NSMutableArray array];
    for (NSInteger i=0; i<count; i++) {
        double second = duration * ((double)i + 0.5) / (double)count;
        NSError *error = nil;
        CGImageRef cg = [generator copyCGImageAtTime:CMTimeMakeWithSeconds(second, 600) actualTime:NULL error:&error];
        if (!cg) continue;
        [images addObject:[[NSImage alloc] initWithCGImage:cg size:NSZeroSize]];
        [timestamps addObject:@(second)]; CGImageRelease(cg);
    }
    if (!images.count) Fail(@"AVFoundation could not extract frames");
    NSImage *first = images[0];
    CGFloat ratio = first.size.height / MAX(first.size.width, 1);
    NSInteger cellWidth = MAX(1, maxWidth / columns);
    NSInteger cellHeight = MAX(1, (NSInteger)llround(cellWidth * ratio));
    NSSize sheetSize = NSMakeSize(cellWidth * columns, cellHeight * rows);
    NSImage *sheet = [[NSImage alloc] initWithSize:sheetSize];
    [sheet lockFocus]; [[NSColor blackColor] setFill]; NSRectFill(NSMakeRect(0, 0, sheetSize.width, sheetSize.height));
    NSDictionary *attrs = @{NSFontAttributeName:[NSFont monospacedDigitSystemFontOfSize:MAX(11, cellWidth/28) weight:NSFontWeightSemibold],
                            NSForegroundColorAttributeName:[NSColor whiteColor],
                            NSBackgroundColorAttributeName:[[NSColor blackColor] colorWithAlphaComponent:.65]};
    for (NSInteger i=0; i<images.count; i++) {
        NSInteger col = i % columns, row = i / columns;
        NSRect target = NSMakeRect(col*cellWidth, sheetSize.height-(row+1)*cellHeight, cellWidth, cellHeight);
        NSImage *frame = (NSImage *)images[i];
        [frame drawInRect:target fromRect:NSZeroRect operation:NSCompositingOperationSourceOver fraction:1 respectFlipped:YES hints:nil];
        NSString *label = [NSString stringWithFormat:@" %.1fs ", [timestamps[i] doubleValue]];
        [label drawAtPoint:NSMakePoint(target.origin.x+6, target.origin.y+6) withAttributes:attrs];
    }
    [sheet unlockFocus];
    CGImageRef sheetCG = [sheet CGImageForProposedRect:NULL context:nil hints:nil];
    NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithCGImage:sheetCG];
    NSData *jpeg = [rep representationUsingType:NSBitmapImageFileTypeJPEG properties:@{NSImageCompressionFactor:@0.86}];
    if (![jpeg writeToFile:output atomically:YES]) Fail(@"Could not write contact sheet");
    Emit(@{@"frame_count":@(images.count), @"timestamps":timestamps,
           @"width":@((NSInteger)sheetSize.width), @"height":@((NSInteger)sheetSize.height)});
}
static NSString *AuthName(SFSpeechRecognizerAuthorizationStatus status) {
    switch (status) { case SFSpeechRecognizerAuthorizationStatusAuthorized: return @"authorized";
        case SFSpeechRecognizerAuthorizationStatusDenied: return @"denied";
        case SFSpeechRecognizerAuthorizationStatusRestricted: return @"restricted";
        default: return @"not_determined"; }
}
static void SpeechStatus(NSString *localeID) {
    SFSpeechRecognizer *recognizer = [[SFSpeechRecognizer alloc] initWithLocale:[[NSLocale alloc] initWithLocaleIdentifier:localeID]];
    BOOL onDevice = NO;
    if (@available(macOS 10.15, *)) onDevice = recognizer.supportsOnDeviceRecognition;
    Emit(@{@"authorization":AuthName([SFSpeechRecognizer authorizationStatus]),
           @"recognizer_available":@(recognizer.available), @"on_device":@(onDevice)});
}
static void SpeechAuthorize(void) {
    [NSApplication sharedApplication];
    [NSApp activateIgnoringOtherApps:YES];
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    __block SFSpeechRecognizerAuthorizationStatus finalStatus = [SFSpeechRecognizer authorizationStatus];
    [SFSpeechRecognizer requestAuthorization:^(SFSpeechRecognizerAuthorizationStatus status) {
        finalStatus = status; dispatch_semaphore_signal(done);
    }];
    long result = dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 120LL*NSEC_PER_SEC));
    if (result != 0) Fail(@"Speech authorization timed out");
    Emit(@{@"authorization":AuthName(finalStatus)});
}
static void SpeechTranscribe(NSString *path, NSString *localeID) {
    if ([SFSpeechRecognizer authorizationStatus] != SFSpeechRecognizerAuthorizationStatusAuthorized) Fail(@"Speech authorization is not granted");
    SFSpeechRecognizer *recognizer = [[SFSpeechRecognizer alloc] initWithLocale:[[NSLocale alloc] initWithLocaleIdentifier:localeID]];
    if (!recognizer.available) Fail(@"Speech recognizer is unavailable");
    if (@available(macOS 10.15, *)) { if (!recognizer.supportsOnDeviceRecognition) Fail(@"On-device recognition is unavailable"); }
    SFSpeechURLRecognitionRequest *request = [[SFSpeechURLRecognitionRequest alloc] initWithURL:[NSURL fileURLWithPath:path]];
    if (@available(macOS 10.15, *)) request.requiresOnDeviceRecognition = YES;
    request.shouldReportPartialResults = NO;
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    __block NSDictionary *output = nil; __block NSString *failure = nil;
    __block SFSpeechRecognitionTask *task = [recognizer recognitionTaskWithRequest:request resultHandler:^(SFSpeechRecognitionResult *result, NSError *error) {
        if (error) { failure = error.localizedDescription; dispatch_semaphore_signal(done); return; }
        if (result && result.final) {
            NSMutableArray *segments = [NSMutableArray array];
            for (SFTranscriptionSegment *segment in result.bestTranscription.segments) {
                [segments addObject:@{@"start":@(segment.timestamp), @"end":@(segment.timestamp+segment.duration),
                                      @"text":segment.substring ?: @"", @"confidence":@(segment.confidence)}];
            }
            output = @{@"text":result.bestTranscription.formattedString ?: @"", @"segments":segments};
            dispatch_semaphore_signal(done);
        }
    }];
    long status = dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 300LL*NSEC_PER_SEC));
    if (status != 0) { [task cancel]; Fail(@"Speech transcription timed out"); }
    if (!output) Fail(failure ?: @"Speech transcription failed without a final result");
    Emit(output);
}
int main(int argc, const char *argv[]) { @autoreleasepool {
    if (argc < 2 || [@(argv[1]) hasPrefix:@"-psn"]) { SpeechAuthorize(); return 0; }
    NSString *command = @(argv[1]);
    if ([command isEqualToString:@"metadata"] && argc == 3) Metadata(@(argv[2]));
    else if ([command isEqualToString:@"contact"] && argc == 7) Contact(@(argv[2]), @(argv[3]), atoi(argv[4]), atoi(argv[5]), atoi(argv[6]));
    else if ([command isEqualToString:@"speech-status"] && argc == 3) SpeechStatus(@(argv[2]));
    else if ([command isEqualToString:@"speech-authorize"] && argc == 2) SpeechAuthorize();
    else if ([command isEqualToString:@"speech-transcribe"] && argc == 4) SpeechTranscribe(@(argv[2]), @(argv[3]));
    else Fail(@"Invalid arguments");
} return 0; }
'''

_ANALYZER_SOURCE = r'''
import Foundation
import AVFoundation
import Speech

@available(macOS 26.0, *)
func transcribe(_ path: String, localeID: String) async throws -> [String: Any] {
    let requested = Locale(identifier: localeID)
    guard SpeechTranscriber.isAvailable else {
        throw NSError(domain: "KikoSpeech", code: 1, userInfo: [NSLocalizedDescriptionKey: "SpeechTranscriber no está disponible en este Mac"])
    }
    guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: requested) else {
        throw NSError(domain: "KikoSpeech", code: 2, userInfo: [NSLocalizedDescriptionKey: "El idioma solicitado no está disponible"])
    }
    let module = SpeechTranscriber(
        locale: locale,
        transcriptionOptions: [],
        reportingOptions: [],
        attributeOptions: [.audioTimeRange]
    )
    if let installer = try await AssetInventory.assetInstallationRequest(supporting: [module]) {
        try await installer.downloadAndInstall()
    }
    let file = try AVAudioFile(forReading: URL(fileURLWithPath: path))
    let collector = Task { () throws -> [[String: Any]] in
        var segments: [[String: Any]] = []
        for try await result in module.results {
            let value = String(result.text.characters).trimmingCharacters(in: .whitespacesAndNewlines)
            guard !value.isEmpty else { continue }
            var start = Double.greatestFiniteMagnitude
            var end = 0.0
            var words: [[String: Any]] = []
            var breakBefore = true
            for run in result.text.runs {
                let token = String(result.text[run.range].characters)
                if token.first?.isWhitespace == true { breakBefore = true }
                let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
                guard let range = run.audioTimeRange, !trimmed.isEmpty else {
                    if token.last?.isWhitespace == true { breakBefore = true }
                    continue
                }
                start = min(start, range.start.seconds)
                end = max(end, range.end.seconds)
                // Los runs pueden partir una palabra o separar su puntuación; se unen hasta el siguiente espacio.
                let punctuationOnly = trimmed.unicodeScalars.allSatisfy { CharacterSet.punctuationCharacters.contains($0) }
                if words.isEmpty || (breakBefore && !punctuationOnly) {
                    words.append(["start": range.start.seconds, "end": range.end.seconds, "text": trimmed])
                } else {
                    var last = words.removeLast()
                    last["text"] = (last["text"] as? String ?? "") + trimmed
                    if !punctuationOnly { last["end"] = max(last["end"] as? Double ?? 0, range.end.seconds) }
                    words.append(last)
                }
                breakBefore = token.last?.isWhitespace == true
            }
            if start == Double.greatestFiniteMagnitude { start = end }
            segments.append(["start": start, "end": max(start + 0.05, end), "text": value, "words": words])
        }
        return segments
    }
    let analyzer = SpeechAnalyzer(modules: [module])
    if let lastSample = try await analyzer.analyzeSequence(from: file) {
        try await analyzer.finalizeAndFinish(through: lastSample)
    } else {
        await analyzer.cancelAndFinishNow()
    }
    let segments = try await collector.value
    return [
        "text": segments.compactMap { $0["text"] as? String }.joined(separator: " "),
        "segments": segments,
        "locale": locale.identifier,
    ]
}

@main struct KikoSpeechAnalyzer {
    static func main() async {
        guard CommandLine.arguments.count == 3 else {
            FileHandle.standardError.write(Data("Uso: kiko-speech-analyzer archivo idioma\n".utf8)); exit(2)
        }
        guard #available(macOS 26.0, *) else {
            FileHandle.standardError.write(Data("SpeechAnalyzer requiere macOS 26 o posterior\n".utf8)); exit(2)
        }
        do {
            let payload = try await transcribe(CommandLine.arguments[1], localeID: CommandLine.arguments[2])
            let data = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
            FileHandle.standardOutput.write(data); FileHandle.standardOutput.write(Data("\n".utf8))
        } catch {
            FileHandle.standardError.write(Data((error.localizedDescription + "\n").utf8)); exit(2)
        }
    }
}
'''


def _analyzer_helper_path() -> Path:
    digest = hashlib.sha256(_ANALYZER_SOURCE.encode("utf-8")).hexdigest()[:16]
    return Path(tempfile.gettempdir()) / ("kiko-speech-analyzer-%s" % digest)


def _compile_analyzer_helper() -> Path:
    if platform.system() != "Darwin" or tuple(int(x) for x in platform.mac_ver()[0].split(".")[:1] or [0]) < (26,):
        raise TranscriptionUnavailableError("SpeechAnalyzer requiere macOS 26 o posterior")
    compiler = shutil.which("swiftc") or shutil.which("xcrun")
    if not compiler:
        raise TranscriptionUnavailableError("El compilador Swift no está disponible")
    binary = _analyzer_helper_path()
    if binary.is_file() and os.access(binary, os.X_OK):
        return binary
    source = binary.with_suffix(".swift")
    source.write_text(_ANALYZER_SOURCE, encoding="utf-8")
    command = ([compiler] if Path(compiler).name == "swiftc" else [compiler, "swiftc"])
    process = subprocess.run(
        [*command, "-parse-as-library", "-O", "-framework", "Speech", "-framework", "AVFoundation", str(source), "-o", str(binary)],
        capture_output=True, text=True,
    )
    try:
        source.unlink()
    except FileNotFoundError:
        pass
    if process.returncode != 0:
        raise TranscriptionUnavailableError(
            "No se pudo preparar SpeechAnalyzer: %s" % (process.stderr.strip() or "error desconocido")
        )
    return binary


def _transcribe_speech_analyzer(source: Path, locale: str) -> TranscriptResult:
    binary = _compile_analyzer_helper()
    try:
        process = subprocess.run(
            [str(binary), str(source), locale], capture_output=True, text=True, timeout=600,
        )
    except subprocess.TimeoutExpired as exc:
        raise EditorialAnalysisError("La transcripción local excedió el tiempo permitido") from exc
    if process.returncode != 0:
        raise EditorialAnalysisError(process.stderr.strip() or "SpeechAnalyzer no pudo transcribir el video")
    try:
        payload = json.loads(process.stdout)
    except json.JSONDecodeError as exc:
        raise EditorialAnalysisError("SpeechAnalyzer devolvió una respuesta inválida") from exc
    segments = tuple(
        TranscriptSegment(
            float(item["start"]),
            float(item["end"]),
            str(item["text"]).strip(),
            words=tuple(
                TranscriptWord(float(word["start"]), float(word["end"]), str(word["text"]).strip())
                for word in item.get("words", []) if str(word.get("text", "")).strip()
            ),
        )
        for item in payload.get("segments", []) if str(item.get("text", "")).strip()
    )
    return TranscriptResult(str(source), "speech_analyzer", str(payload.get("locale", locale)), str(payload.get("text", "")).strip(), segments)


def _helper_path() -> Path:
    digest = hashlib.sha256(b"bundle-v4\0" + _HELPER_SOURCE.encode("utf-8")).hexdigest()[:16]
    bundle = Path(tempfile.gettempdir()) / ("KikoEditorial-%s.app" % digest)
    return bundle / "Contents" / "MacOS" / "kiko-editorial"


def _compile_helper() -> Path:
    if platform.system() != "Darwin":
        raise EditorialAnalysisError("AVFoundation solo está disponible en macOS")
    compiler = shutil.which("clang")
    if not compiler:
        raise EditorialAnalysisError("clang no está disponible para compilar el helper local")
    binary = _helper_path()
    if binary.is_file() and os.access(binary, os.X_OK):
        return binary
    binary.parent.mkdir(parents=True, exist_ok=True)
    bundle = binary.parents[2]
    info = {
        "CFBundleExecutable": binary.name,
        "CFBundleIdentifier": "com.kikostudio.editorial.%s" % hashlib.sha256(_HELPER_SOURCE.encode("utf-8")).hexdigest()[:12],
        "CFBundleInfoDictionaryVersion": "6.0",
        "CFBundleName": "Kiko Studio Transcription",
        "CFBundlePackageType": "APPL",
        "CFBundleShortVersionString": "1.0",
        "CFBundleVersion": "1",
        "LSUIElement": True,
        "NSSpeechRecognitionUsageDescription": "Kiko Studio usa el reconocimiento local para escuchar tus videos y crear subtítulos.",
    }
    info_path = bundle / "Contents" / "Info.plist"
    with info_path.open("wb") as stream:
        plistlib.dump(info, stream)
    source = Path(tempfile.gettempdir()) / ("%s-%s.m" % (binary.name, bundle.stem))
    source.write_text(_HELPER_SOURCE, encoding="utf-8")
    process = subprocess.run(
        [
            compiler,
            "-fobjc-arc",
            "-framework", "Foundation",
            "-framework", "AVFoundation",
            "-framework", "CoreMedia",
            "-framework", "AppKit",
            "-framework", "Speech",
            "-Wl,-sectcreate,__TEXT,__info_plist,%s" % info_path,
            str(source),
            "-o", str(binary),
        ],
        capture_output=True,
        text=True,
    )
    try:
        source.unlink()
    except FileNotFoundError:
        pass
    if process.returncode != 0:
        raise EditorialAnalysisError(
            "No se pudo compilar el helper AVFoundation: %s" % (process.stderr.strip() or "error desconocido")
        )
    signer = shutil.which("codesign")
    if signer:
        signed = subprocess.run(
            [signer, "--force", "--sign", "-", str(bundle)], capture_output=True, text=True
        )
        if signed.returncode != 0:
            raise EditorialAnalysisError(
                "No se pudo firmar el helper de transcripción: %s" % (signed.stderr.strip() or "error desconocido")
            )
    return binary


def _run_helper(arguments: Sequence[str], timeout: int = 60) -> Mapping[str, Any]:
    binary = _compile_helper()
    try:
        process = subprocess.run(
            [str(binary), *arguments],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        raise EditorialAnalysisError("La operación AVFoundation excedió el tiempo permitido") from exc
    if process.returncode != 0:
        raise EditorialAnalysisError(process.stderr.strip() or "AVFoundation devolvió un error")
    try:
        return json.loads(process.stdout)
    except (TypeError, json.JSONDecodeError) as exc:
        raise EditorialAnalysisError("AVFoundation devolvió una respuesta inválida") from exc


def _media_path(path: Union[str, os.PathLike[str]]) -> Path:
    source = Path(path).expanduser().resolve()
    if not source.is_file():
        raise FileNotFoundError("No existe el clip: %s" % source)
    if source.suffix.lower() not in {".mov", ".mp4", ".m4v"}:
        raise ValueError("Solo se admiten clips MOV, MP4 o M4V")
    return source


def inspect_media(path: Union[str, os.PathLike[str]]) -> MediaMetadata:
    source = _media_path(path)
    payload = _run_helper(["metadata", str(source)])
    stat = source.stat()
    created = getattr(stat, "st_birthtime", None)
    width, height = int(payload["width"]), int(payload["height"])
    return MediaMetadata(
        path=str(source),
        filename=source.name,
        size_bytes=stat.st_size,
        modified_at=datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
        created_at=datetime.fromtimestamp(created, timezone.utc).isoformat() if created else None,
        duration_seconds=round(float(payload["duration"]), 3),
        width=width,
        height=height,
        orientation="portrait" if height > width else ("landscape" if width > height else "square"),
        rotation_degrees=int(payload.get("rotation", 0)),
        has_audio=bool(payload["has_audio"]),
        video_codec=payload.get("video_codec"),
        audio_codec=payload.get("audio_codec"),
        nominal_fps=round(float(payload["fps"]), 3) if payload.get("fps") is not None else None,
        extraction_backend="avfoundation",
    )


def generate_contact_sheet(
    path: Union[str, os.PathLike[str]],
    destination: Union[str, os.PathLike[str]],
    *,
    columns: int = 3,
    rows: int = 2,
    max_width: int = 1200,
) -> ThumbnailResult:
    source = _media_path(path)
    if columns < 1 or rows < 1 or columns * rows > 24:
        raise ValueError("La hoja debe contener entre 1 y 24 cuadros")
    if max_width < columns * 80:
        raise ValueError("max_width es demasiado pequeño para las columnas solicitadas")
    output = Path(destination).expanduser().resolve()
    if output.suffix.lower() not in {".jpg", ".jpeg"}:
        raise ValueError("La hoja de contacto debe guardarse como JPEG")
    output.parent.mkdir(parents=True, exist_ok=True)
    payload = _run_helper(
        ["contact", str(source), str(output), str(columns), str(rows), str(max_width)],
        timeout=180,
    )
    if not output.is_file() or output.stat().st_size == 0:
        raise EditorialAnalysisError("AVFoundation no generó la hoja de contacto")
    return ThumbnailResult(
        source_path=str(source),
        output_path=str(output),
        frame_count=int(payload["frame_count"]),
        timestamps_seconds=tuple(round(float(value), 3) for value in payload["timestamps"]),
        width=int(payload["width"]),
        height=int(payload["height"]),
    )


def detect_transcription_backends(locale: str = "es-CO") -> list[TranscriptionAvailability]:
    results: list[TranscriptionAvailability] = []
    mac_major = 0
    try:
        mac_major = int((platform.mac_ver()[0] or "0").split(".")[0])
    except ValueError:
        pass
    swift = shutil.which("swiftc") or shutil.which("xcrun")
    analyzer_ready = platform.system() == "Darwin" and mac_major >= 26 and bool(swift)
    results.append(
        TranscriptionAvailability(
            backend="speech_analyzer",
            installed=analyzer_ready,
            ready=analyzer_ready,
            on_device=True,
            authorization="not_required",
            reason="listo para transcripción privada en el dispositivo" if analyzer_ready else "requiere macOS 26 y Swift",
            executable=str(_analyzer_helper_path()) if analyzer_ready else None,
        )
    )
    whisper = shutil.which("whisper")
    ffmpeg = shutil.which("ffmpeg")
    model_dir = Path.home() / ".cache" / "whisper"
    local_models = sorted(model_dir.glob("*.pt")) if model_dir.is_dir() else []
    whisper_ready = bool(whisper and ffmpeg and local_models)
    missing = []
    if not whisper:
        missing.append("CLI whisper no instalada")
    if not ffmpeg:
        missing.append("ffmpeg no disponible")
    if not local_models:
        missing.append("ningún modelo Whisper local detectado")
    results.append(
        TranscriptionAvailability(
            backend="whisper_cli",
            installed=bool(whisper),
            ready=whisper_ready,
            on_device=True,
            authorization="not_applicable",
            reason="listo con modelo local" if whisper_ready else "; ".join(missing),
            executable=whisper,
        )
    )
    try:
        status = _run_helper(["speech-status", locale])
        authorization = str(status.get("authorization", "unknown"))
        on_device = bool(status.get("on_device"))
        recognizer_available = bool(status.get("recognizer_available"))
        ready = authorization == "authorized" and on_device and recognizer_available
        reasons = []
        if authorization != "authorized":
            reasons.append("autorización Speech: %s" % authorization)
        if not on_device:
            reasons.append("reconocimiento en el dispositivo no disponible")
        if not recognizer_available:
            reasons.append("reconocedor no disponible")
        results.append(
            TranscriptionAvailability(
                backend="macos_speech",
                installed=True,
                ready=ready,
                on_device=on_device,
                authorization=authorization,
                reason="listo para reconocimiento local" if ready else "; ".join(reasons),
                executable=str(_helper_path()),
            )
        )
    except EditorialAnalysisError as exc:
        results.append(
            TranscriptionAvailability(
                backend="macos_speech",
                installed=False,
                ready=False,
                on_device=False,
                authorization="unknown",
                reason=str(exc),
            )
        )
    return results


def request_speech_authorization(locale: str = "es-CO") -> TranscriptionAvailability:
    """Ask macOS for local Speech permission, then return the verified status."""

    binary = _compile_helper()
    bundle = binary.parents[2]
    try:
        process = subprocess.run(
            ["open", "-W", str(bundle), "--args", "speech-authorize"],
            capture_output=True,
            text=True,
            timeout=130,
        )
    except subprocess.TimeoutExpired as exc:
        raise EditorialAnalysisError("La autorización de voz excedió el tiempo permitido") from exc
    if process.returncode != 0:
        raise EditorialAnalysisError(process.stderr.strip() or "macOS no pudo abrir la autorización de voz")
    statuses = {item.backend: item for item in detect_transcription_backends(locale)}
    return statuses["macos_speech"]


def _transcribe_macos(source: Path, locale: str) -> TranscriptResult:
    payload = _run_helper(["speech-transcribe", str(source), locale], timeout=330)
    segments = tuple(
        TranscriptSegment(
            start=float(item["start"]),
            end=float(item["end"]),
            text=str(item["text"]),
            confidence=float(item["confidence"]) if item.get("confidence") is not None else None,
        )
        for item in payload.get("segments", [])
    )
    return TranscriptResult(str(source), "macos_speech", locale, str(payload.get("text", "")), segments)


def _transcribe_whisper(source: Path, language: str, model_path: Path) -> TranscriptResult:
    whisper = shutil.which("whisper")
    if not whisper:
        raise TranscriptionUnavailableError("CLI whisper no instalada")
    with tempfile.TemporaryDirectory(prefix="kiko-whisper-") as directory:
        process = subprocess.run(
            [
                whisper,
                str(source),
                "--model", model_path.stem,
                "--model_dir", str(model_path.parent),
                "--language", language,
                "--output_format", "json",
                "--output_dir", directory,
                "--verbose", "False",
            ],
            capture_output=True,
            text=True,
        )
        if process.returncode != 0:
            raise EditorialAnalysisError(process.stderr.strip() or "Whisper local falló")
        output = Path(directory) / (source.stem + ".json")
        if not output.is_file():
            raise EditorialAnalysisError("Whisper no produjo JSON")
        payload = json.loads(output.read_text(encoding="utf-8"))
    segments = tuple(
        TranscriptSegment(float(item["start"]), float(item["end"]), str(item["text"]).strip())
        for item in payload.get("segments", [])
    )
    return TranscriptResult(str(source), "whisper_cli", language, str(payload.get("text", "")).strip(), segments)


def transcribe_local(
    path: Union[str, os.PathLike[str]],
    *,
    backend: str = "auto",
    locale: str = "es-CO",
    whisper_model: Optional[str] = None,
) -> TranscriptResult:
    source = _media_path(path)
    available = {item.backend: item for item in detect_transcription_backends(locale)}
    if backend == "auto":
        backend = next(
            (name for name in ("speech_analyzer", "whisper_cli", "macos_speech")
             if available.get(name) and available[name].ready),
            "",
        )
    if not backend:
        details = "; ".join("%s: %s" % (item.backend, item.reason) for item in available.values())
        raise TranscriptionUnavailableError("No hay transcripción local disponible. %s" % details)
    if backend not in available:
        raise ValueError("Backend de transcripción desconocido: %s" % backend)
    if not available[backend].ready:
        details = "; ".join("%s: %s" % (item.backend, item.reason) for item in available.values())
        raise TranscriptionUnavailableError("No hay transcripción local disponible. %s" % details)
    if backend == "speech_analyzer":
        return _transcribe_speech_analyzer(source, locale)
    if backend == "macos_speech":
        return _transcribe_macos(source, locale)
    models = sorted((Path.home() / ".cache" / "whisper").glob("*.pt"))
    if whisper_model:
        candidate = Path.home() / ".cache" / "whisper" / (whisper_model + ".pt")
        if not candidate.is_file():
            raise TranscriptionUnavailableError("El modelo Whisper solicitado no existe localmente")
        model = candidate
    else:
        model = models[0]
    return _transcribe_whisper(source, locale.split("-")[0], model)


def _timestamp(seconds: float) -> str:
    whole = max(0, int(round(seconds)))
    return "%02d:%02d" % (whole // 60, whole % 60)


def _chunks(text: str, count: int) -> list[str]:
    paragraphs = [" ".join(part.split()) for part in text.splitlines() if part.strip()]
    if not paragraphs:
        return []
    if len(paragraphs) >= count:
        return paragraphs
    words = " ".join(paragraphs).split()
    size = max(1, math.ceil(len(words) / count))
    return [" ".join(words[index:index + size]) for index in range(0, len(words), size)]


def build_editorial_brief(
    items: Iterable[Union[MediaMetadata, str, os.PathLike[str]]],
    *,
    supplied_text: Optional[Union[str, Mapping[str, str]]] = None,
    title: Optional[str] = None,
) -> EditorialBrief:
    metadata = [item if isinstance(item, MediaMetadata) else inspect_media(item) for item in items]
    if not metadata:
        raise ValueError("Se necesita al menos un clip")
    metadata.sort(key=lambda item: (item.created_at or item.modified_at, item.filename.casefold()))
    cursor = 0.0
    chronology = []
    for index, clip in enumerate(metadata, 1):
        start, end = cursor, cursor + clip.duration_seconds
        chronology.append(
            {
                "order": index,
                "clip": clip.filename,
                "start": round(start, 3),
                "end": round(end, 3),
                "duration": clip.duration_seconds,
                "recorded_or_modified_at": clip.created_at or clip.modified_at,
            }
        )
        cursor = end

    source_basis = "metadata_only"
    transcript_status = "not_attempted_no_supplied_text"
    script = []
    if isinstance(supplied_text, str) and supplied_text.strip():
        source_basis = "supplied_text"
        transcript_status = "user_supplied_text_not_machine_transcription"
        parts = _chunks(supplied_text, len(metadata))
        for index, clip in enumerate(metadata):
            segment = chronology[index]
            text = parts[min(index, len(parts) - 1)] if parts else ""
            script.append(
                {
                    "clip": clip.filename,
                    "time_range": "%s–%s" % (_timestamp(segment["start"]), _timestamp(segment["end"])),
                    "text": text,
                    "text_source": "supplied_text",
                }
            )
    elif isinstance(supplied_text, Mapping):
        source_basis = "supplied_text"
        transcript_status = "user_supplied_text_not_machine_transcription"
        for clip, segment in zip(metadata, chronology):
            text = supplied_text.get(clip.filename) or supplied_text.get(clip.path) or ""
            script.append(
                {
                    "clip": clip.filename,
                    "time_range": "%s–%s" % (_timestamp(segment["start"]), _timestamp(segment["end"])),
                    "text": " ".join(text.split()),
                    "text_source": "supplied_text" if text.strip() else "missing",
                }
            )
    else:
        for clip, segment in zip(metadata, chronology):
            script.append(
                {
                    "clip": clip.filename,
                    "time_range": "%s–%s" % (_timestamp(segment["start"]), _timestamp(segment["end"])),
                    "text": "[Revisar visualmente; no hay texto ni transcripción verificada para este clip]",
                    "text_source": "none",
                }
            )
    return EditorialBrief(
        title=(title or "Secuencia editorial de %s a %s" % (metadata[0].filename, metadata[-1].filename)).strip(),
        source_basis=source_basis,
        transcript_status=transcript_status,
        clips=tuple(item.as_dict() for item in metadata),
        chronology=tuple(chronology),
        script=tuple(script),
        editorial_notes=(
            "El orden se basa en la fecha del archivo y, en empate, en el nombre.",
            "Los rangos son una concatenación cronológica, no cortes recomendados.",
            "No se atribuye diálogo a un clip sin texto aportado o transcripción local real.",
        ),
    )

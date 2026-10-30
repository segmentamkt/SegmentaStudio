"""macOS AVFoundation fallback used when ffmpeg is unavailable.

The implementation compiles a small, auditable Swift helper on first use.  It
uses only frameworks shipped with macOS and stores the compiled helper in the
system temporary directory, never in the user's project.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import tempfile
from typing import Any


class NativeVideoError(RuntimeError):
    pass


SWIFT_SOURCE = r'''
import Foundation
import AVFoundation
import CoreMedia
import CoreVideo
import QuartzCore

func fail(_ message: String) -> Never {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    exit(2)
}

func json(_ object: Any) {
    let data = try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    print(String(data: data, encoding: .utf8)!)
}

func assetInfo(_ path: String) {
    let asset = AVURLAsset(url: URL(fileURLWithPath: path))
    guard let video = asset.tracks(withMediaType: .video).first else { fail("No video track") }
    let rect = CGRect(origin: .zero, size: video.naturalSize).applying(video.preferredTransform).standardized
    let audio = asset.tracks(withMediaType: .audio).first
    let duration = CMTimeGetSeconds(asset.duration)
    var vcodec = "unknown"
    if let desc = video.formatDescriptions.first {
        let subtype = CMFormatDescriptionGetMediaSubType(desc as! CMFormatDescription)
        vcodec = String(format: "%c%c%c%c", (subtype >> 24) & 255, (subtype >> 16) & 255, (subtype >> 8) & 255, subtype & 255)
    }
    json(["duration": duration.isFinite ? duration : 0,
          "width": Int(abs(rect.width.rounded())), "height": Int(abs(rect.height.rounded())),
          "has_audio": audio != nil, "video_codec": vcodec, "audio_codec": audio == nil ? NSNull() : "native"])
}

func exportVideo(_ source: String, _ output: String, _ width: Int, _ height: Int, _ purple: String, _ subtitle: String) {
    let asset = AVURLAsset(url: URL(fileURLWithPath: source))
    guard let sourceVideo = asset.tracks(withMediaType: .video).first else { fail("No video track") }
    let composition = AVMutableComposition()
    guard let video = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else { fail("Cannot create video track") }
    let range = CMTimeRange(start: .zero, duration: asset.duration)
    do { try video.insertTimeRange(range, of: sourceVideo, at: .zero) } catch { fail("Cannot import video: \(error)") }
    if let sourceAudio = asset.tracks(withMediaType: .audio).first,
       let audio = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) {
        try? audio.insertTimeRange(range, of: sourceAudio, at: .zero)
    }

    let render = CGSize(width: width, height: height)
    let natural = sourceVideo.naturalSize
    let oriented = CGRect(origin: .zero, size: natural).applying(sourceVideo.preferredTransform).standardized
    let scale = min(render.width / oriented.width, render.height / oriented.height)
    var transform = sourceVideo.preferredTransform
    transform = transform.concatenating(CGAffineTransform(translationX: -oriented.minX, y: -oriented.minY))
    transform = transform.concatenating(CGAffineTransform(scaleX: scale, y: scale))
    transform = transform.concatenating(CGAffineTransform(translationX: (render.width - oriented.width * scale) / 2.0,
                                                            y: (render.height - oriented.height * scale) / 2.0))
    let layerInstruction = AVMutableVideoCompositionLayerInstruction(assetTrack: video)
    layerInstruction.setTransform(transform, at: .zero)
    let instruction = AVMutableVideoCompositionInstruction()
    instruction.timeRange = CMTimeRange(start: .zero, duration: composition.duration)
    instruction.layerInstructions = [layerInstruction]
    let color = purple.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
    var rgb: UInt64 = 0x2E1065
    Scanner(string: color).scanHexInt64(&rgb)
    instruction.backgroundColor = CGColor(red: CGFloat((rgb >> 16) & 255) / 255,
                                          green: CGFloat((rgb >> 8) & 255) / 255,
                                          blue: CGFloat(rgb & 255) / 255, alpha: 1)
    let videoComposition = AVMutableVideoComposition()
    videoComposition.renderSize = render
    videoComposition.frameDuration = CMTime(value: 1, timescale: 30)
    videoComposition.instructions = [instruction]

    if !subtitle.isEmpty {
        let parent = CALayer(); parent.frame = CGRect(origin: .zero, size: render)
        let videoLayer = CALayer(); videoLayer.frame = parent.frame
        parent.addSublayer(videoLayer)
        let text = CATextLayer()
        text.string = subtitle
        text.alignmentMode = .center
        text.foregroundColor = CGColor(gray: 1, alpha: 1)
        text.backgroundColor = CGColor(red: 46/255, green: 16/255, blue: 101/255, alpha: 0.85)
        text.fontSize = max(20, render.width / 18)
        text.contentsScale = 2
        text.isWrapped = true
        text.frame = CGRect(x: render.width * 0.06, y: render.height * 0.06,
                            width: render.width * 0.88, height: render.height * 0.14)
        parent.addSublayer(text)
        videoComposition.animationTool = AVVideoCompositionCoreAnimationTool(postProcessingAsVideoLayer: videoLayer, in: parent)
    }

    try? FileManager.default.removeItem(atPath: output)
    guard let exporter = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else { fail("Cannot create exporter") }
    exporter.outputURL = URL(fileURLWithPath: output)
    exporter.outputFileType = .mp4
    exporter.shouldOptimizeForNetworkUse = true
    exporter.videoComposition = videoComposition
    let semaphore = DispatchSemaphore(value: 0)
    exporter.exportAsynchronously { semaphore.signal() }
    semaphore.wait()
    guard exporter.status == .completed else { fail("Native export failed: \(exporter.error?.localizedDescription ?? "unknown error")") }
    json(["ok": true])
}

func synthetic(_ output: String, _ duration: Double, _ width: Int, _ height: Int) {
    try? FileManager.default.removeItem(atPath: output)
    let writer: AVAssetWriter
    do { writer = try AVAssetWriter(outputURL: URL(fileURLWithPath: output), fileType: .mp4) }
    catch { fail("Cannot create synthetic writer: \(error)") }
    let settings: [String: Any] = [AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: width, AVVideoHeightKey: height,
        AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 1_000_000]]
    let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
    input.expectsMediaDataInRealTime = false
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input,
        sourcePixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
                                      kCVPixelBufferWidthKey as String: width,
                                      kCVPixelBufferHeightKey as String: height])
    guard writer.canAdd(input) else { fail("Cannot add synthetic track") }
    writer.add(input); writer.startWriting(); writer.startSession(atSourceTime: .zero)
    let frames = max(1, Int(duration * 30))
    for frame in 0..<frames {
        while !input.isReadyForMoreMediaData { usleep(1000) }
        var buffer: CVPixelBuffer?
        CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &buffer)
        guard let pixel = buffer else { fail("Cannot allocate synthetic frame") }
        CVPixelBufferLockBaseAddress(pixel, [])
        let base = CVPixelBufferGetBaseAddress(pixel)!.assumingMemoryBound(to: UInt8.self)
        let stride = CVPixelBufferGetBytesPerRow(pixel)
        for y in 0..<height {
            for x in 0..<width {
                let i = y * stride + x * 4
                base[i] = UInt8((x + frame * 3) % 256)
                base[i + 1] = UInt8((y + frame * 2) % 256)
                base[i + 2] = UInt8((x + y + frame * 5) % 256)
                base[i + 3] = 255
            }
        }
        CVPixelBufferUnlockBaseAddress(pixel, [])
        adaptor.append(pixel, withPresentationTime: CMTime(value: Int64(frame), timescale: 30))
    }
    input.markAsFinished()
    let semaphore = DispatchSemaphore(value: 0)
    writer.finishWriting { semaphore.signal() }
    semaphore.wait()
    guard writer.status == .completed else { fail("Synthetic export failed: \(writer.error?.localizedDescription ?? "unknown error")") }
    json(["ok": true, "audio": false])
}

func silences(_ path: String, _ thresholdDB: Double, _ minimum: Double) {
    let asset = AVURLAsset(url: URL(fileURLWithPath: path))
    guard let track = asset.tracks(withMediaType: .audio).first else { json([]); return }
    let reader: AVAssetReader
    do { reader = try AVAssetReader(asset: asset) } catch { fail("Cannot read audio: \(error)") }
    let output = AVAssetReaderTrackOutput(track: track, outputSettings: [
        AVFormatIDKey: kAudioFormatLinearPCM, AVLinearPCMIsFloatKey: true,
        AVLinearPCMBitDepthKey: 32, AVLinearPCMIsNonInterleaved: false])
    guard reader.canAdd(output) else { fail("Cannot decode audio") }
    reader.add(output); reader.startReading()
    var start: Double? = nil
    var lastEnd = 0.0
    var result: [[String: Double]] = []
    while let sample = output.copyNextSampleBuffer() {
        let pts = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sample))
        let duration = CMTimeGetSeconds(CMSampleBufferGetDuration(sample))
        let count = CMSampleBufferGetNumSamples(sample)
        guard let block = CMSampleBufferGetDataBuffer(sample) else { continue }
        var length = 0; var pointer: UnsafeMutablePointer<Int8>?
        if CMBlockBufferGetDataPointer(block, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &length, dataPointerOut: &pointer) != noErr { continue }
        let values = pointer!.withMemoryRebound(to: Float.self, capacity: length / 4) { UnsafeBufferPointer(start: $0, count: length / 4) }
        var energy = 0.0
        for value in values { energy += Double(value * value) }
        let rms = values.isEmpty ? 0 : sqrt(energy / Double(values.count))
        let db = rms > 0 ? 20 * log10(rms) : -160
        let chunkDuration = duration.isFinite && duration > 0 ? duration : Double(count) / 48000.0
        lastEnd = pts + chunkDuration
        if db <= thresholdDB {
            if start == nil { start = pts }
        } else if let s = start {
            if pts - s >= minimum { result.append(["start": s, "end": pts]) }
            start = nil
        }
    }
    if let s = start, lastEnd - s >= minimum { result.append(["start": s, "end": lastEnd]) }
    json(result)
}

let args = CommandLine.arguments
guard args.count >= 3 else { fail("Usage: native-video <probe|export|synthetic|silences> ...") }
switch args[1] {
case "probe": assetInfo(args[2])
case "export":
    guard args.count >= 8 else { fail("Missing export arguments") }
    exportVideo(args[2], args[3], Int(args[4])!, Int(args[5])!, args[6], args[7])
case "synthetic":
    guard args.count >= 7 else { fail("Missing synthetic arguments") }
    synthetic(args[2], Double(args[3])!, Int(args[4])!, Int(args[5])!)
case "silences":
    guard args.count >= 5 else { fail("Missing silence arguments") }
    silences(args[2], Double(args[3])!, Double(args[4])!)
default: fail("Unknown command")
}
'''

# Objective-C is deliberately used for the compiled fallback. Unlike Swift it
# remains ABI-compatible when Command Line Tools and the macOS SDK have slightly
# different point releases (a fairly common state immediately after an update).
OBJC_SOURCE = r'''
#import <Foundation/Foundation.h>
#import <AVFoundation/AVFoundation.h>
#import <CoreVideo/CoreVideo.h>
#import <CoreText/CoreText.h>
#import <QuartzCore/QuartzCore.h>
#import <VideoToolbox/VideoToolbox.h>
#import <ImageIO/ImageIO.h>

static void Fail(NSString *message) {
    fprintf(stderr, "%s\n", message.UTF8String); exit(2);
}
static void JSON(id object) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:object options:NSJSONWritingSortedKeys error:nil];
    printf("%s\n", [[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] UTF8String]);
}
static AVURLAsset *Asset(NSString *path) { return [AVURLAsset URLAssetWithURL:[NSURL fileURLWithPath:path] options:nil]; }

static CGImageRef TextImage(NSString *value, CGSize size, CTFontRef font, CGColorRef color, CGColorRef background) {
    size_t width = MAX(1, (size_t)ceil(size.width));
    size_t height = MAX(1, (size_t)ceil(size.height));
    CGColorSpaceRef space = CGColorSpaceCreateDeviceRGB();
    CGContextRef context = CGBitmapContextCreate(NULL, width, height, 8, width * 4, space,
                                                  kCGImageAlphaPremultipliedLast);
    CGColorSpaceRelease(space);
    if (!context) return NULL;

    CGContextSetFillColorWithColor(context, background);
    CGContextFillRect(context, CGRectMake(0, 0, size.width, size.height));
    CGContextSetTextMatrix(context, CGAffineTransformIdentity);
    CTTextAlignment alignment = kCTCenterTextAlignment;
    CTParagraphStyleSetting setting = {kCTParagraphStyleSpecifierAlignment, sizeof(alignment), &alignment};
    CTParagraphStyleRef paragraph = CTParagraphStyleCreate(&setting, 1);
    NSDictionary *attributes = @{
        (__bridge NSString *)kCTFontAttributeName: (__bridge id)font,
        (__bridge NSString *)kCTForegroundColorAttributeName: (__bridge id)color,
        (__bridge NSString *)kCTParagraphStyleAttributeName: (__bridge id)paragraph
    };
    NSAttributedString *string = [[NSAttributedString alloc] initWithString:value attributes:attributes];
    CTFramesetterRef framesetter = CTFramesetterCreateWithAttributedString((__bridge CFAttributedStringRef)string);
    CGMutablePathRef path = CGPathCreateMutable();
    CGPathAddRect(path, NULL, CGRectMake(0, 0, size.width, size.height));
    CTFrameRef frame = CTFramesetterCreateFrame(framesetter, CFRangeMake(0, 0), path, NULL);
    CTFrameDraw(frame, context);
    CGImageRef image = CGBitmapContextCreateImage(context);
    CFRelease(frame); CGPathRelease(path); CFRelease(framesetter); CFRelease(paragraph); CGContextRelease(context);
    return image;
}

static void Probe(NSString *path) {
    AVURLAsset *asset = Asset(path);
    AVAssetTrack *video = [[asset tracksWithMediaType:AVMediaTypeVideo] firstObject];
    if (!video) Fail(@"No video track");
    CGRect rect = CGRectStandardize(CGRectApplyAffineTransform((CGRect){CGPointZero, video.naturalSize}, video.preferredTransform));
    BOOL audio = [asset tracksWithMediaType:AVMediaTypeAudio].count > 0;
    double seconds = CMTimeGetSeconds(asset.duration);
    JSON(@{@"duration": @(isfinite(seconds) ? seconds : 0), @"width": @((NSInteger)llround(fabs(rect.size.width))),
           @"height": @((NSInteger)llround(fabs(rect.size.height))), @"has_audio": @(audio),
           @"video_codec": @"native", @"audio_codec": audio ? @"native" : [NSNull null]});
}

static void Export(NSString *source, NSString *output, NSInteger width, NSInteger height,
                   NSString *hex, NSString *subtitle, double start, double end) {
    AVURLAsset *asset = Asset(source);
    AVAssetTrack *sourceVideo = [[asset tracksWithMediaType:AVMediaTypeVideo] firstObject];
    if (!sourceVideo) Fail(@"No video track");
    AVMutableComposition *composition = [AVMutableComposition composition];
    AVMutableCompositionTrack *video = [composition addMutableTrackWithMediaType:AVMediaTypeVideo preferredTrackID:kCMPersistentTrackID_Invalid];
    NSError *error = nil;
    CMTime sourceStart = CMTimeMakeWithSeconds(start, 600);
    CMTime sourceDuration = end > start ? CMTimeMakeWithSeconds(end-start, 600) : CMTimeSubtract(asset.duration, sourceStart);
    CMTimeRange range = CMTimeRangeMake(sourceStart, sourceDuration);
    if (![video insertTimeRange:range ofTrack:sourceVideo atTime:kCMTimeZero error:&error]) Fail(error.localizedDescription);
    AVAssetTrack *sourceAudio = [[asset tracksWithMediaType:AVMediaTypeAudio] firstObject];
    if (sourceAudio) {
        AVMutableCompositionTrack *audio = [composition addMutableTrackWithMediaType:AVMediaTypeAudio preferredTrackID:kCMPersistentTrackID_Invalid];
        [audio insertTimeRange:range ofTrack:sourceAudio atTime:kCMTimeZero error:nil];
    }
    CGSize render = CGSizeMake(width, height);
    CGRect oriented = CGRectStandardize(CGRectApplyAffineTransform((CGRect){CGPointZero, sourceVideo.naturalSize}, sourceVideo.preferredTransform));
    CGFloat scale = MIN(render.width / oriented.size.width, render.height / oriented.size.height);
    CGAffineTransform transform = sourceVideo.preferredTransform;
    transform = CGAffineTransformConcat(transform, CGAffineTransformMakeTranslation(-oriented.origin.x, -oriented.origin.y));
    transform = CGAffineTransformConcat(transform, CGAffineTransformMakeScale(scale, scale));
    transform = CGAffineTransformConcat(transform, CGAffineTransformMakeTranslation((render.width-oriented.size.width*scale)/2,
                                                                                     (render.height-oriented.size.height*scale)/2));
    AVMutableVideoCompositionLayerInstruction *layer = [AVMutableVideoCompositionLayerInstruction videoCompositionLayerInstructionWithAssetTrack:video];
    [layer setTransform:transform atTime:kCMTimeZero];
    AVMutableVideoCompositionInstruction *instruction = [AVMutableVideoCompositionInstruction videoCompositionInstruction];
    instruction.timeRange = CMTimeRangeMake(kCMTimeZero, composition.duration); instruction.layerInstructions = @[layer];
    unsigned rgb = 0x2E1065; NSScanner *scanner = [NSScanner scannerWithString:[hex stringByReplacingOccurrencesOfString:@"0x" withString:@""]];
    [scanner scanHexInt:&rgb];
    instruction.backgroundColor = CGColorCreateGenericRGB(((rgb>>16)&255)/255.0, ((rgb>>8)&255)/255.0, (rgb&255)/255.0, 1);
    AVMutableVideoComposition *videoComp = [AVMutableVideoComposition videoComposition];
    videoComp.renderSize = render; videoComp.frameDuration = CMTimeMake(1, 30); videoComp.instructions = @[instruction];
    if (subtitle.length) {
        CALayer *parent = [CALayer layer]; parent.frame = (CGRect){CGPointZero, render};
        CALayer *videoLayer = [CALayer layer]; videoLayer.frame = parent.frame; [parent addSublayer:videoLayer];
        CATextLayer *text = [CATextLayer layer]; text.string = subtitle; text.alignmentMode = kCAAlignmentCenter;
        text.foregroundColor = CGColorCreateGenericGray(1, 1); text.backgroundColor = CGColorCreateGenericRGB(46/255.0,16/255.0,101/255.0,.85);
        text.fontSize = MAX(20, width/18); text.contentsScale = 2; text.wrapped = YES;
        text.frame = CGRectMake(width*.06, height*.06, width*.88, height*.14); [parent addSublayer:text];
        videoComp.animationTool = [AVVideoCompositionCoreAnimationTool videoCompositionCoreAnimationToolWithPostProcessingAsVideoLayer:videoLayer inLayer:parent];
    }
    [[NSFileManager defaultManager] removeItemAtPath:output error:nil];
    AVAssetExportSession *session = [[AVAssetExportSession alloc] initWithAsset:composition presetName:AVAssetExportPresetHighestQuality];
    if (!session) Fail(@"Cannot create native exporter");
    session.outputURL = [NSURL fileURLWithPath:output]; session.outputFileType = AVFileTypeMPEG4;
    session.shouldOptimizeForNetworkUse = YES; session.videoComposition = videoComp;
    dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
    [session exportAsynchronouslyWithCompletionHandler:^{ dispatch_semaphore_signal(semaphore); }];
    dispatch_semaphore_wait(semaphore, DISPATCH_TIME_FOREVER);
    if (session.status != AVAssetExportSessionStatusCompleted) Fail([@"Native export failed: " stringByAppendingString:session.error.localizedDescription ?: @"unknown"]);
    JSON(@{@"ok": @YES});
}

static void Synthetic(NSString *output, double duration, NSInteger width, NSInteger height) {
    [[NSFileManager defaultManager] removeItemAtPath:output error:nil]; NSError *error = nil;
    AVAssetWriter *writer = [[AVAssetWriter alloc] initWithURL:[NSURL fileURLWithPath:output] fileType:AVFileTypeMPEG4 error:&error];
    if (!writer) Fail(error.localizedDescription);
    NSDictionary *settings = @{AVVideoCodecKey:AVVideoCodecTypeH264, AVVideoWidthKey:@(width), AVVideoHeightKey:@(height),
                               AVVideoEncoderSpecificationKey:@{(__bridge NSString *)kVTVideoEncoderSpecification_EnableHardwareAcceleratedVideoEncoder:@NO},
                               AVVideoCompressionPropertiesKey:@{AVVideoAverageBitRateKey:@1000000}};
    AVAssetWriterInput *input = [AVAssetWriterInput assetWriterInputWithMediaType:AVMediaTypeVideo outputSettings:settings];
    NSDictionary *attrs = @{(id)kCVPixelBufferPixelFormatTypeKey:@(kCVPixelFormatType_32BGRA),
                            (id)kCVPixelBufferWidthKey:@(width), (id)kCVPixelBufferHeightKey:@(height)};
    AVAssetWriterInputPixelBufferAdaptor *adaptor = [AVAssetWriterInputPixelBufferAdaptor assetWriterInputPixelBufferAdaptorWithAssetWriterInput:input sourcePixelBufferAttributes:attrs];
    [writer addInput:input]; [writer startWriting]; [writer startSessionAtSourceTime:kCMTimeZero];
    NSInteger frames = MAX(1, llround(duration*30));
    for (NSInteger frame=0; frame<frames; frame++) {
        while (!input.readyForMoreMediaData) usleep(1000);
        CVPixelBufferRef pixel = NULL;
        if (adaptor.pixelBufferPool) CVPixelBufferPoolCreatePixelBuffer(NULL, adaptor.pixelBufferPool, &pixel);
        if (!pixel) CVPixelBufferCreate(NULL, width, height, kCVPixelFormatType_32BGRA,
                                        (__bridge CFDictionaryRef)attrs, &pixel);
        if (!pixel) Fail(@"Cannot allocate synthetic frame");
        CVPixelBufferLockBaseAddress(pixel, 0); uint8_t *base = CVPixelBufferGetBaseAddress(pixel); size_t stride = CVPixelBufferGetBytesPerRow(pixel);
        for (NSInteger y=0; y<height; y++) for (NSInteger x=0; x<width; x++) { size_t i=y*stride+x*4;
            base[i]=(x+frame*3)%256; base[i+1]=(y+frame*2)%256; base[i+2]=(x+y+frame*5)%256; base[i+3]=255; }
        CVPixelBufferUnlockBaseAddress(pixel, 0); [adaptor appendPixelBuffer:pixel withPresentationTime:CMTimeMake(frame,30)]; CVPixelBufferRelease(pixel);
    }
    [input markAsFinished]; dispatch_semaphore_t semaphore=dispatch_semaphore_create(0);
    [writer finishWritingWithCompletionHandler:^{dispatch_semaphore_signal(semaphore);}]; dispatch_semaphore_wait(semaphore,DISPATCH_TIME_FOREVER);
    if (writer.status != AVAssetWriterStatusCompleted) Fail(writer.error.localizedDescription ?: @"Synthetic export failed");
    JSON(@{@"ok":@YES,@"audio":@NO});
}

static void Compose(NSString *planPath, NSString *output) {
    NSData *data = [NSData dataWithContentsOfFile:planPath];
    NSDictionary *plan = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    NSArray *clips = plan[@"clips"]; if (!clips.count) Fail(@"Timeline has no clips");
    NSInteger width = [plan[@"width"] integerValue], height = [plan[@"height"] integerValue];
    CGSize render = CGSizeMake(width, height);
    AVMutableComposition *composition = [AVMutableComposition composition];
    AVMutableCompositionTrack *videoTrack = [composition addMutableTrackWithMediaType:AVMediaTypeVideo preferredTrackID:kCMPersistentTrackID_Invalid];
    AVMutableCompositionTrack *dialogueTrack = nil;
    NSMutableArray *instructions = [NSMutableArray array];
    NSMutableArray *audioParams = [NSMutableArray array];
    AVMutableAudioMixInputParameters *dialogueParams = nil;
    CMTime cursor = kCMTimeZero;
    for (NSDictionary *clip in clips) {
        AVURLAsset *asset = Asset(clip[@"path"]); AVAssetTrack *sourceVideo = [[asset tracksWithMediaType:AVMediaTypeVideo] firstObject];
        if (!sourceVideo) Fail(@"A timeline clip has no video track");
        double start = [clip[@"start"] doubleValue], duration = [clip[@"duration"] doubleValue];
        CMTimeRange sourceRange = CMTimeRangeMake(CMTimeMakeWithSeconds(start,600), CMTimeMakeWithSeconds(duration,600));
        NSError *error=nil; if (![videoTrack insertTimeRange:sourceRange ofTrack:sourceVideo atTime:cursor error:&error]) Fail(error.localizedDescription);
        AVAssetTrack *sourceAudio = [[asset tracksWithMediaType:AVMediaTypeAudio] firstObject];
        if (sourceAudio) {
            if (!dialogueTrack) {
                dialogueTrack = [composition addMutableTrackWithMediaType:AVMediaTypeAudio preferredTrackID:kCMPersistentTrackID_Invalid];
                dialogueParams = [AVMutableAudioMixInputParameters audioMixInputParametersWithTrack:dialogueTrack];
            }
            [dialogueTrack insertTimeRange:sourceRange ofTrack:sourceAudio atTime:cursor error:nil];
            [dialogueParams setVolume:MIN(1.0,MAX(0.0,[clip[@"volume"] doubleValue])) atTime:cursor];
        }
        CGRect oriented = CGRectStandardize(CGRectApplyAffineTransform((CGRect){CGPointZero,sourceVideo.naturalSize},sourceVideo.preferredTransform));
        BOOL fill=[plan[@"framing"] isEqual:@"fill"];
        CGFloat scale=fill?MAX(render.width/oriented.size.width,render.height/oriented.size.height):MIN(render.width/oriented.size.width,render.height/oriented.size.height); CGAffineTransform transform=sourceVideo.preferredTransform;
        transform=CGAffineTransformConcat(transform,CGAffineTransformMakeTranslation(-oriented.origin.x,-oriented.origin.y));
        transform=CGAffineTransformConcat(transform,CGAffineTransformMakeScale(scale,scale));
        transform=CGAffineTransformConcat(transform,CGAffineTransformMakeTranslation((render.width-oriented.size.width*scale)/2,(render.height-oriented.size.height*scale)/2));
        AVMutableVideoCompositionLayerInstruction *layer=[AVMutableVideoCompositionLayerInstruction videoCompositionLayerInstructionWithAssetTrack:videoTrack];
        [layer setTransform:transform atTime:cursor]; AVMutableVideoCompositionInstruction *instruction=[AVMutableVideoCompositionInstruction videoCompositionInstruction];
        instruction.timeRange=CMTimeRangeMake(cursor,sourceRange.duration); instruction.layerInstructions=@[layer];
        unsigned rgb=0x2E1065; NSString *hex=[plan[@"purple"] stringByReplacingOccurrencesOfString:@"0x" withString:@""]; [[NSScanner scannerWithString:hex] scanHexInt:&rgb];
        instruction.backgroundColor=CGColorCreateGenericRGB(((rgb>>16)&255)/255.0,((rgb>>8)&255)/255.0,(rgb&255)/255.0,1); [instructions addObject:instruction];
        cursor=CMTimeAdd(cursor,sourceRange.duration);
    }
    if (dialogueParams) [audioParams addObject:dialogueParams]; double total=CMTimeGetSeconds(cursor);

    void (^addAudio)(NSDictionary *, BOOL) = ^(NSDictionary *item, BOOL loop) {
        if (![item isKindOfClass:[NSDictionary class]] || !item[@"path"]) return;
        AVURLAsset *asset=Asset(item[@"path"]); AVAssetTrack *source=[[asset tracksWithMediaType:AVMediaTypeAudio] firstObject]; if (!source) return;
        AVMutableCompositionTrack *track=[composition addMutableTrackWithMediaType:AVMediaTypeAudio preferredTrackID:kCMPersistentTrackID_Invalid];
        double start=MAX(0,[item[@"start"] doubleValue]); CMTime at=CMTimeMakeWithSeconds(start,600); double remaining=MAX(0,total-start);
        double assetSeconds=CMTimeGetSeconds(asset.duration); if (assetSeconds<=0) return;
        do { double take=MIN(remaining,assetSeconds); [track insertTimeRange:CMTimeRangeMake(kCMTimeZero,CMTimeMakeWithSeconds(take,600)) ofTrack:source atTime:at error:nil];
             at=CMTimeAdd(at,CMTimeMakeWithSeconds(take,600)); remaining-=take; } while(loop && remaining>.001);
        AVMutableAudioMixInputParameters *params=[AVMutableAudioMixInputParameters audioMixInputParametersWithTrack:track];
        double defaultVolume=loop?.18:.7; [params setVolume:MIN(1.0,MAX(0.0,item[@"volume"]?[item[@"volume"] doubleValue]:defaultVolume)) atTime:kCMTimeZero];
        [audioParams addObject:params];
    };
    NSDictionary *music=plan[@"music"]; if ([music isKindOfClass:[NSDictionary class]]) addAudio(music, music[@"loop"] ? [music[@"loop"] boolValue] : YES);
    for (NSDictionary *sound in plan[@"sounds"]) addAudio(sound,NO);

    AVMutableVideoComposition *videoComp=[AVMutableVideoComposition videoComposition]; videoComp.renderSize=render;
    videoComp.frameDuration=CMTimeMake(1,30); videoComp.instructions=instructions;
    NSArray *subtitles=plan[@"subtitles"], *labels=plan[@"labels"], *images=plan[@"images"];
    if (subtitles.count || labels.count || images.count) {
        NSDictionary *style=plan[@"subtitle_style"]?:@{}; NSString *position=style[@"position"]?:@"bottom";
        NSString *textHex=(style[@"text_color"]?:@"FFFFFF");
        textHex=[[[textHex stringByReplacingOccurrencesOfString:@"#" withString:@""] stringByReplacingOccurrencesOfString:@"0x" withString:@""] stringByReplacingOccurrencesOfString:@"0X" withString:@""];
        NSString *backgroundHex=(style[@"background_color"]?:@"2E1065CC");
        backgroundHex=[[[backgroundHex stringByReplacingOccurrencesOfString:@"#" withString:@""] stringByReplacingOccurrencesOfString:@"0x" withString:@""] stringByReplacingOccurrencesOfString:@"0X" withString:@""];
        unsigned textRGBA=0xFFFFFF, backgroundRGBA=0x2E1065CC; [[NSScanner scannerWithString:textHex] scanHexInt:&textRGBA]; [[NSScanner scannerWithString:backgroundHex] scanHexInt:&backgroundRGBA];
        CGFloat textAlpha=textHex.length>6?(textRGBA&255)/255.0:1, backgroundAlpha=backgroundHex.length>6?(backgroundRGBA&255)/255.0:1;
        if ([style[@"template"] isEqual:@"minimal"]) backgroundAlpha=0;
        CGFloat boxY=[position isEqual:@"top"]?height*.78:([position isEqual:@"center"]?height*.43:height*.06);
        CALayer *parent=[CALayer layer]; parent.frame=(CGRect){CGPointZero,render}; CALayer *videoLayer=[CALayer layer]; videoLayer.frame=parent.frame; [parent addSublayer:videoLayer];
        CALayer *text=[CALayer layer]; CGSize textSize=CGSizeMake(width*.88,height*.14); text.frame=CGRectMake(width*.06,boxY,textSize.width,textSize.height); text.contentsGravity=kCAGravityCenter; text.zPosition=5;
        CGColorRef foreground=CGColorCreateGenericRGB(((textRGBA>>(textHex.length>6?24:16))&255)/255.0,((textRGBA>>(textHex.length>6?16:8))&255)/255.0,((textRGBA>>(textHex.length>6?8:0))&255)/255.0,textAlpha);
        CGColorRef background=CGColorCreateGenericRGB(((backgroundRGBA>>(backgroundHex.length>6?24:16))&255)/255.0,((backgroundRGBA>>(backgroundHex.length>6?16:8))&255)/255.0,((backgroundRGBA>>(backgroundHex.length>6?8:0))&255)/255.0,backgroundAlpha);
        CGColorRef clear=CGColorCreateGenericRGB(0,0,0,0); CGFloat fontSize=style[@"font_size"]?[style[@"font_size"] doubleValue]:MAX(20,width/18); CTFontRef font=CTFontCreateWithName(CFSTR("Helvetica-Bold"),fontSize,NULL);
        CGImageRef blankImage=TextImage(@"",textSize,font,clear,clear); id blank=(__bridge id)blankImage; text.contents=blank;
        NSMutableArray *values=[NSMutableArray arrayWithObject:blank]; NSMutableArray *times=[NSMutableArray arrayWithObject:@0]; double frame=1.0/30.0;
        for (NSDictionary *subtitle in subtitles) { double start=MAX(0,[subtitle[@"start"] doubleValue]), end=MIN(total,[subtitle[@"end"] doubleValue]); if (end<=start) continue;
            CGImageRef image=TextImage(subtitle[@"text"]?:@"",textSize,font,foreground,background); id content=(__bridge id)image;
            [values addObject:blank]; [times addObject:@(MAX(0,start-frame)/total)]; [values addObject:content]; [times addObject:@(start/total)];
            [values addObject:content]; [times addObject:@(MAX(start,end-frame)/total)]; [values addObject:blank]; [times addObject:@(end/total)]; CGImageRelease(image);
        }
        [values addObject:blank]; [times addObject:@1]; CAKeyframeAnimation *captions=[CAKeyframeAnimation animationWithKeyPath:@"contents"];
        captions.values=values; captions.keyTimes=times; captions.calculationMode=kCAAnimationDiscrete; captions.beginTime=AVCoreAnimationBeginTimeAtZero; captions.duration=total; captions.fillMode=kCAFillModeBoth; captions.removedOnCompletion=NO;
        [text addAnimation:captions forKey:@"timedCaptions"]; [parent addSublayer:text]; CGImageRelease(blankImage); CFRelease(font); CGColorRelease(foreground); CGColorRelease(background); CGColorRelease(clear);
        for (NSDictionary *label in labels) {
            double start=MAX(0,[label[@"start"] doubleValue]), end=MIN(total,[label[@"end"] doubleValue]); if(end<=start) continue;
            BOOL fullScreen=[label[@"full_screen"] boolValue]; NSString *position=label[@"position"]?:@"top";
            CGSize labelSize=fullScreen?render:CGSizeMake(width*.82,height*.075);
            CGFloat labelY=fullScreen?0:([position isEqual:@"bottom"]?height*.16:([position isEqual:@"center"]?height*.47:height*.82));
            NSString *cardHex=label[@"background_color"]?:@"111111E0"; cardHex=[[[cardHex stringByReplacingOccurrencesOfString:@"#" withString:@""] stringByReplacingOccurrencesOfString:@"0x" withString:@""] stringByReplacingOccurrencesOfString:@"0X" withString:@""];
            unsigned cardRGBA=0x111111E0; [[NSScanner scannerWithString:cardHex] scanHexInt:&cardRGBA]; CGFloat cardAlpha=fullScreen?1:(cardHex.length>6?(cardRGBA&255)/255.0:.88);
            CGColorRef white=CGColorCreateGenericRGB(1,1,1,1), dark=CGColorCreateGenericRGB(((cardRGBA>>(cardHex.length>6?24:16))&255)/255.0,((cardRGBA>>(cardHex.length>6?16:8))&255)/255.0,((cardRGBA>>(cardHex.length>6?8:0))&255)/255.0,cardAlpha);
            CTFontRef labelFont=CTFontCreateWithName(CFSTR("Helvetica-Bold"),fullScreen?MAX(48,width/12):MAX(22,width/24),NULL);
            CGImageRef labelImage=TextImage(label[@"text"]?:@"",labelSize,labelFont,white,dark); CALayer *badge=[CALayer layer]; badge.frame=fullScreen?parent.frame:CGRectMake(width*.09,labelY,labelSize.width,labelSize.height); badge.contents=(__bridge id)labelImage; badge.contentsGravity=kCAGravityCenter; badge.opacity=0; badge.zPosition=fullScreen?8:4;
            CAKeyframeAnimation *show=[CAKeyframeAnimation animationWithKeyPath:@"opacity"]; show.values=@[@0,@0,@1,@1,@0,@0]; show.keyTimes=@[@0,@(MAX(0,start-frame)/total),@(start/total),@(MAX(start,end-frame)/total),@(end/total),@1]; show.calculationMode=kCAAnimationDiscrete; show.beginTime=AVCoreAnimationBeginTimeAtZero; show.duration=total; show.fillMode=kCAFillModeBoth; show.removedOnCompletion=NO; [badge addAnimation:show forKey:@"visibility"]; [parent addSublayer:badge];
            CGImageRelease(labelImage); CFRelease(labelFont); CGColorRelease(white); CGColorRelease(dark);
        }
        for (NSDictionary *image in images) {
            double start=MAX(0,[image[@"start"] doubleValue]), end=MIN(total,[image[@"end"] doubleValue]); if(end<=start) continue;
            NSURL *url=[NSURL fileURLWithPath:image[@"path"]?:@""]; CGImageSourceRef source=CGImageSourceCreateWithURL((__bridge CFURLRef)url,NULL); if(!source) continue; CGImageRef cg=CGImageSourceCreateImageAtIndex(source,0,NULL); CFRelease(source); if(!cg) continue;
            CGFloat targetWidth=width*MIN(.95,MAX(.1,image[@"width_percent"]?[image[@"width_percent"] doubleValue]:.72)); CGFloat ratio=(CGFloat)CGImageGetHeight(cg)/MAX(1,(CGFloat)CGImageGetWidth(cg)); CGFloat targetHeight=MIN(height*.38,targetWidth*ratio); NSString *position=image[@"position"]?:@"center"; CGFloat imageY=[position isEqual:@"bottom"]?height*.12:([position isEqual:@"top"]?height-targetHeight-height*.10:(height-targetHeight)/2);
            CALayer *picture=[CALayer layer]; picture.frame=CGRectMake((width-targetWidth)/2,imageY,targetWidth,targetHeight); picture.contents=(__bridge id)cg; picture.contentsGravity=kCAGravityResizeAspect; picture.cornerRadius=18; picture.masksToBounds=YES; picture.opacity=0; picture.zPosition=1;
            CAKeyframeAnimation *show=[CAKeyframeAnimation animationWithKeyPath:@"opacity"]; show.values=@[@0,@0,@1,@1,@0,@0]; show.keyTimes=@[@0,@(MAX(0,start-frame)/total),@(start/total),@(MAX(start,end-frame)/total),@(end/total),@1]; show.calculationMode=kCAAnimationDiscrete; show.beginTime=AVCoreAnimationBeginTimeAtZero; show.duration=total; show.fillMode=kCAFillModeBoth; show.removedOnCompletion=NO; [picture addAnimation:show forKey:@"visibility"]; [parent addSublayer:picture]; CGImageRelease(cg);
        }
        videoComp.animationTool=[AVVideoCompositionCoreAnimationTool videoCompositionCoreAnimationToolWithPostProcessingAsVideoLayer:videoLayer inLayer:parent];
    }
    AVMutableAudioMix *audioMix=[AVMutableAudioMix audioMix]; audioMix.inputParameters=audioParams;
    [[NSFileManager defaultManager] removeItemAtPath:output error:nil]; AVAssetExportSession *session=[[AVAssetExportSession alloc] initWithAsset:composition presetName:AVAssetExportPresetHighestQuality];
    session.outputURL=[NSURL fileURLWithPath:output]; session.outputFileType=AVFileTypeMPEG4; session.shouldOptimizeForNetworkUse=YES;
    session.videoComposition=videoComp; if (audioParams.count) session.audioMix=audioMix; dispatch_semaphore_t semaphore=dispatch_semaphore_create(0);
    [session exportAsynchronouslyWithCompletionHandler:^{dispatch_semaphore_signal(semaphore);}]; dispatch_semaphore_wait(semaphore,DISPATCH_TIME_FOREVER);
    if(session.status!=AVAssetExportSessionStatusCompleted) Fail([@"Native timeline export failed: " stringByAppendingString:session.error.localizedDescription?:@"unknown"]);
    JSON(@{@"ok":@YES,@"duration":@(total)});
}

int main(int argc, const char *argv[]) { @autoreleasepool {
    if (argc < 3) Fail(@"Usage: native-video <probe|export|synthetic> ...");
    NSString *command=@(argv[1]); NSString *path=@(argv[2]);
    if ([command isEqual:@"probe"]) Probe(path);
    else if ([command isEqual:@"export"] && argc>=10) Export(path,@(argv[3]),atoi(argv[4]),atoi(argv[5]),@(argv[6]),@(argv[7]),atof(argv[8]),atof(argv[9]));
    else if ([command isEqual:@"synthetic"] && argc>=6) Synthetic(path,atof(argv[3]),atoi(argv[4]),atoi(argv[5]));
    else if ([command isEqual:@"compose"] && argc>=4) Compose(path,@(argv[3]));
    else if ([command isEqual:@"silences"]) Fail(@"Native silence analysis is unavailable; install ffmpeg for silence detection");
    else Fail(@"Unknown command or missing arguments");
} return 0; }
'''


def is_available() -> bool:
    return platform.system() == "Darwin" and shutil.which("clang") is not None


def _helper_path() -> Path:
    digest = hashlib.sha256(OBJC_SOURCE.encode()).hexdigest()[:16]
    return Path(tempfile.gettempdir()) / f"kiko-native-video-{digest}"


def ensure_helper() -> Path:
    if not is_available():
        raise NativeVideoError("The native video fallback requires macOS and the Swift compiler.")
    helper = _helper_path()
    if helper.is_file() and os.access(helper, os.X_OK):
        return helper
    source = helper.with_suffix(".m")
    source.write_text(OBJC_SOURCE, encoding="utf-8")
    compiler = shutil.which("clang")
    if not compiler:
        raise NativeVideoError("The native video fallback requires the Apple clang compiler.")
    environment = os.environ.copy()
    environment["CLANG_MODULE_CACHE_PATH"] = str(Path(tempfile.gettempdir()) / "kiko-clang-cache")
    result = subprocess.run(
        [compiler, "-fobjc-arc", "-O2", "-framework", "Foundation", "-framework", "AVFoundation",
         "-framework", "QuartzCore", "-framework", "CoreGraphics", "-framework", "CoreText", "-framework", "CoreMedia",
         "-framework", "CoreVideo", "-framework", "VideoToolbox", "-framework", "ImageIO", str(source), "-o", str(helper)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=environment,
    )
    try:
        source.unlink()
    except FileNotFoundError:
        pass
    if result.returncode != 0:
        raise NativeVideoError(f"Could not compile the native video helper: {result.stderr.strip()}")
    return helper


def _run(*arguments: object) -> Any:
    result = subprocess.run(
        [str(ensure_helper()), *(str(value) for value in arguments)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if result.returncode != 0:
        raise NativeVideoError(result.stderr.strip() or "Native video operation failed")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise NativeVideoError("Native video helper returned invalid data") from exc


def probe(path: Path) -> dict[str, Any]:
    target = Path(path)
    payload = dict(_run("probe", target))
    payload["playable"] = bool(
        target.is_file()
        and target.stat().st_size > 0
        and float(payload.get("duration", 0) or 0) > 0
        and int(payload.get("width", 0) or 0) > 0
        and int(payload.get("height", 0) or 0) > 0
    )
    return payload


def export_vertical(
    source: Path,
    destination: Path,
    width: int,
    height: int,
    purple: str,
    subtitle: str | None,
    start_time: float = 0.0,
    end_time: float | None = None,
) -> None:
    _run("export", source, destination, width, height, purple, subtitle or "", start_time, end_time or -1)


def generate_synthetic(destination: Path, duration: float, width: int, height: int) -> None:
    _run("synthetic", destination, duration, width, height, "unused")


def detect_silences(path: Path, noise_db: float, min_duration: float) -> list[dict[str, float]]:
    return _run("silences", path, noise_db, min_duration)


def compose_timeline(plan: dict[str, Any], destination: Path) -> None:
    """Run the native single-pass AVFoundation timeline composer."""

    # Keep the Objective-C boundary strict even when callers use this low-level
    # function directly instead of video_engine.compose_timeline.
    native_plan = dict(plan)
    style = dict(native_plan.get("subtitle_style") or {})
    style["text_color"] = normalize_hex_color(style.get("text_color", "FFFFFF"))
    style["background_color"] = normalize_hex_color(
        style.get("background_color", "2E1065CC")
    )
    native_plan["subtitle_style"] = style
    descriptor_fd, descriptor_name = tempfile.mkstemp(prefix="kiko-timeline-", suffix=".json")
    os.close(descriptor_fd)
    descriptor = Path(descriptor_name)
    try:
        descriptor.write_text(json.dumps(native_plan, ensure_ascii=False), encoding="utf-8")
        _run("compose", descriptor, destination)
    finally:
        try:
            descriptor.unlink()
        except FileNotFoundError:
            pass


def normalize_hex_color(value: object) -> str:
    """Return uppercase RRGGBB/RRGGBBAA accepted by the native scanner."""

    color = str(value).strip()
    if color.startswith("#"):
        color = color[1:]
    elif color[:2].lower() == "0x":
        color = color[2:]
    if not re.fullmatch(r"[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?", color):
        raise NativeVideoError("Subtitle colors must use #RRGGBB or #RRGGBBAA hexadecimal form.")
    return color.upper()


def generate_test_video(
    path: str | Path, *, duration: float = 2.0, width: int = 180, height: int = 320
) -> dict[str, Any]:
    """Backward-compatible synthetic MP4 generator used by the app validation."""
    destination = Path(path).expanduser().resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    generate_synthetic(destination, duration, width, height)
    details = probe(destination)
    return {"path": str(destination), "container": "mp4", **details}

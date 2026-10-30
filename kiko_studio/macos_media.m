#import <Foundation/Foundation.h>
#import <AVFoundation/AVFoundation.h>
#import <CoreVideo/CoreVideo.h>

static void emitJSON(NSDictionary *value) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingSortedKeys error:nil];
    printf("%s\n", [[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] UTF8String]);
}

static BOOL generate(NSString *path, double duration, int width, int height, NSString **failure) {
    NSURL *url = [NSURL fileURLWithPath:path];
    [[NSFileManager defaultManager] createDirectoryAtURL:[url URLByDeletingLastPathComponent]
                              withIntermediateDirectories:YES attributes:nil error:nil];
    [[NSFileManager defaultManager] removeItemAtURL:url error:nil];
    NSError *error = nil;
    AVAssetWriter *writer = [[AVAssetWriter alloc] initWithURL:url fileType:AVFileTypeMPEG4 error:&error];
    if (!writer) { *failure = error.localizedDescription; return NO; }
    NSDictionary *settings = @{AVVideoCodecKey: AVVideoCodecTypeHEVC,
                               AVVideoWidthKey: @(width), AVVideoHeightKey: @(height),
                               AVVideoCompressionPropertiesKey: @{AVVideoAverageBitRateKey: @1500000}};
    AVAssetWriterInput *input = [AVAssetWriterInput assetWriterInputWithMediaType:AVMediaTypeVideo outputSettings:settings];
    input.expectsMediaDataInRealTime = NO;
    NSDictionary *attributes = @{(NSString *)kCVPixelBufferPixelFormatTypeKey: @(kCVPixelFormatType_32BGRA),
                                 (NSString *)kCVPixelBufferWidthKey: @(width),
                                 (NSString *)kCVPixelBufferHeightKey: @(height)};
    AVAssetWriterInputPixelBufferAdaptor *adaptor =
      [AVAssetWriterInputPixelBufferAdaptor assetWriterInputPixelBufferAdaptorWithAssetWriterInput:input
                                                                       sourcePixelBufferAttributes:attributes];
    if (![writer canAddInput:input]) { *failure = @"AVAssetWriter rejected video input"; return NO; }
    [writer addInput:input];
    if (![writer startWriting]) { *failure = writer.error.localizedDescription; return NO; }
    [writer startSessionAtSourceTime:kCMTimeZero];
    const int fps = 30;
    int frames = MAX(1, (int)(duration * fps));
    for (int frame = 0; frame < frames; frame++) {
        while (!input.readyForMoreMediaData) { [NSThread sleepForTimeInterval:0.002]; }
        CVPixelBufferRef pixel = NULL;
        if (CVPixelBufferPoolCreatePixelBuffer(NULL, adaptor.pixelBufferPool, &pixel) != kCVReturnSuccess) {
            *failure = @"could not allocate pixel buffer"; return NO;
        }
        CVPixelBufferLockBaseAddress(pixel, 0);
        uint8_t *base = CVPixelBufferGetBaseAddress(pixel);
        size_t stride = CVPixelBufferGetBytesPerRow(pixel);
        double progress = (double)frame / (double)frames;
        int centerX = (int)(progress * (width + 160)) - 80;
        int centerY = (int)(height * 0.45);
        for (int y = 0; y < height; y++) {
            uint8_t *row = base + y * stride;
            for (int x = 0; x < width; x++) {
                BOOL circle = ((x-centerX)*(x-centerX) + (y-centerY)*(y-centerY)) < 80*80;
                row[x*4+0] = circle ? 230 : 56;  // blue
                row[x*4+1] = circle ? 94  : 18;  // green
                row[x*4+2] = circle ? 122 : 31;  // red
                row[x*4+3] = 255;
            }
        }
        CVPixelBufferUnlockBaseAddress(pixel, 0);
        BOOL appended = [adaptor appendPixelBuffer:pixel withPresentationTime:CMTimeMake(frame, fps)];
        CVPixelBufferRelease(pixel);
        if (!appended) { *failure = writer.error.localizedDescription; return NO; }
    }
    [input markAsFinished];
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    [writer finishWritingWithCompletionHandler:^{ dispatch_semaphore_signal(done); }];
    dispatch_semaphore_wait(done, DISPATCH_TIME_FOREVER);
    if (writer.status != AVAssetWriterStatusCompleted) { *failure = writer.error.localizedDescription; return NO; }
    emitJSON(@{@"path": path, @"duration": @(duration), @"width": @(width), @"height": @(height),
               @"codec": @"hevc", @"container": @"mp4", @"frames": @(frames)});
    return YES;
}

static BOOL probe(NSString *path, NSString **failure) {
    AVURLAsset *asset = [AVURLAsset URLAssetWithURL:[NSURL fileURLWithPath:path] options:nil];
    NSArray<AVAssetTrack *> *videos = [asset tracksWithMediaType:AVMediaTypeVideo];
    if (videos.count == 0) { *failure = @"no video track found"; return NO; }
    AVAssetTrack *video = videos.firstObject;
    CGSize size = CGSizeApplyAffineTransform(video.naturalSize, video.preferredTransform);
    double seconds = CMTimeGetSeconds(asset.duration);
    emitJSON(@{@"path": path, @"duration": @(seconds), @"width": @((int)fabs(size.width)),
               @"height": @((int)fabs(size.height)), @"playable": @(asset.playable),
               @"has_video": @YES, @"has_audio": @([asset tracksWithMediaType:AVMediaTypeAudio].count > 0)});
    return YES;
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc < 3) { fprintf(stderr, "usage: kiko-macos-media generate|probe path\n"); return 2; }
        NSString *command = @(argv[1]); NSString *path = @(argv[2]); NSString *failure = nil; BOOL ok = NO;
        if ([command isEqualToString:@"generate"]) {
            double duration = argc > 3 ? atof(argv[3]) : 2.0;
            int width = argc > 4 ? atoi(argv[4]) : 360; int height = argc > 5 ? atoi(argv[5]) : 640;
            ok = generate(path, duration, width, height, &failure);
        } else if ([command isEqualToString:@"probe"]) { ok = probe(path, &failure); }
        else { failure = @"unknown command"; }
        if (!ok) { fprintf(stderr, "%s\n", [failure ?: @"operation failed" UTF8String]); return 1; }
        return 0;
    }
}


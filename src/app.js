  (function () {
    "use strict";

    const CACHE_CHUNK_BYTES = 4 * 1024 * 1024;
    const MAX_CACHE_BYTES = 64 * 1024 * 1024;
    const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
    const ROW_HEIGHT = 32;
    const GRAPH_ROW_HEIGHT = 30;
    const METRIC_CHART_WIDTH = 1000;
    const METRIC_CHART_HEIGHT = 230;
    const METRIC_CHART_PADDING = { left: 64, right: 22, top: 18, bottom: 30 };

    const CONTAINER_BOXES = new Set([
      "moov", "trak", "mdia", "minf", "stbl", "edts", "dinf", "mvex", "moof", "traf",
      "mfra", "udta", "ilst", "tref", "ipro", "sinf", "schi"
    ]);

    const FULLBOX_CONTAINER_OFFSETS = new Map([
      ["meta", 4]
    ]);

    const PARSED_FIELD_BOXES = new Set([
      "ftyp", "mvhd", "tkhd", "mdhd", "hdlr", "stsd", "stts", "ctts", "stss", "stsc",
      "stsz", "stz2", "stco", "co64", "trex", "mfhd", "tfhd", "tfdt", "trun"
    ]);

    const VIDEO_SAMPLE_ENTRIES = new Set([
      "avc1", "avc2", "avc3", "avc4", "hvc1", "hev1", "av01", "encv", "mp4v",
      "ap4h", "ap4x", "apch", "apcn", "apcs", "apco", "aprn", "aprh"
    ]);
    const AUDIO_SAMPLE_ENTRIES = new Set(["mp4a", "enca", "ac-3", "ec-3", "Opus", "alac"]);
    const AUDIO_SAMPLE_RATES = [
      96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050,
      16000, 12000, 11025, 8000, 7350
    ];
    const AUDIO_OBJECT_TYPE_NAMES = {
      1: "AAC Main",
      2: "AAC LC",
      3: "AAC SSR",
      4: "AAC LTP",
      5: "SBR",
      6: "AAC Scalable",
      17: "ER AAC LC",
      29: "PS",
      42: "USAC"
    };
    const HEVC_IRAP_NAL_TYPES = new Set([16, 17, 18, 19, 20, 21, 22, 23]);
    const BOX_TYPE_INFO = {
      ftyp: {
        name: "File Type Box",
        description: "Declares the MP4/QuickTime brand, minor version, and compatible brands."
      },
      moov: {
        name: "Movie Box",
        description: "Top-level metadata container for tracks, timing, and sample tables."
      },
      mdat: {
        name: "Media Data Box",
        description: "Contains encoded media payload bytes referenced by sample tables."
      },
      free: {
        name: "Free Space Box",
        description: "Padding or reserved bytes that can be overwritten later."
      },
      skip: {
        name: "Skip Box",
        description: "Padding or ignored bytes, similar to free."
      },
      wide: {
        name: "Wide Box",
        description: "Legacy QuickTime padding used to reserve space for large-size boxes."
      },
      uuid: {
        name: "UUID Box",
        description: "Vendor-specific extension box identified by a 16-byte UUID."
      },
      trak: {
        name: "Track Box",
        description: "Container for one media track, such as video, audio, or subtitles."
      },
      tkhd: {
        name: "Track Header Box",
        description: "Track-level ID, duration, dimensions, layer, and display metadata."
      },
      edts: {
        name: "Edit Box",
        description: "Container for edit-list timing adjustments."
      },
      elst: {
        name: "Edit List Box",
        description: "Maps presentation timeline segments to media timeline ranges."
      },
      mdia: {
        name: "Media Box",
        description: "Container for media timing, handler, and media information."
      },
      mdhd: {
        name: "Media Header Box",
        description: "Track media timescale, duration, and language."
      },
      hdlr: {
        name: "Handler Reference Box",
        description: "Declares the track handler type, such as vide or soun."
      },
      minf: {
        name: "Media Information Box",
        description: "Container for media-specific header, data references, and sample table."
      },
      vmhd: {
        name: "Video Media Header Box",
        description: "Video-track presentation metadata such as graphics mode."
      },
      smhd: {
        name: "Sound Media Header Box",
        description: "Audio-track presentation metadata such as balance."
      },
      hmhd: {
        name: "Hint Media Header Box",
        description: "Hint-track metadata for streaming."
      },
      nmhd: {
        name: "Null Media Header Box",
        description: "Generic media header for tracks without a specialized media header."
      },
      dinf: {
        name: "Data Information Box",
        description: "Container describing where media data is located."
      },
      dref: {
        name: "Data Reference Box",
        description: "Lists data references used by sample entries."
      },
      url: {
        name: "Data Entry URL Box",
        description: "A URL data reference, often self-contained in MP4 files."
      },
      urn: {
        name: "Data Entry URN Box",
        description: "A URN data reference for media data."
      },
      stbl: {
        name: "Sample Table Box",
        description: "Container for tables that map samples to timing, sizes, chunks, and offsets."
      },
      stsd: {
        name: "Sample Description Box",
        description: "Declares codec sample entries and codec configuration boxes."
      },
      stts: {
        name: "Decoding Time to Sample Box",
        description: "Maps samples to decode durations and DTS progression."
      },
      ctts: {
        name: "Composition Time to Sample Box",
        description: "Stores PTS offsets relative to DTS for reordered frames."
      },
      stsc: {
        name: "Sample to Chunk Box",
        description: "Maps sample runs to chunk numbers and samples-per-chunk."
      },
      stsz: {
        name: "Sample Size Box",
        description: "Stores per-sample byte sizes or one constant sample size."
      },
      stz2: {
        name: "Compact Sample Size Box",
        description: "Stores compact 4/8/16-bit per-sample sizes."
      },
      stco: {
        name: "Chunk Offset Box",
        description: "Stores 32-bit file offsets for media data chunks."
      },
      co64: {
        name: "64-bit Chunk Offset Box",
        description: "Stores 64-bit file offsets for media data chunks."
      },
      stss: {
        name: "Sync Sample Box",
        description: "Lists random-access sync samples, usually keyframes."
      },
      stsh: {
        name: "Shadow Sync Sample Box",
        description: "Maps non-sync samples to shadow sync samples."
      },
      sdtp: {
        name: "Sample Dependency Type Box",
        description: "Stores per-sample dependency flags for random access and prediction."
      },
      sbgp: {
        name: "Sample to Group Box",
        description: "Maps sample ranges to sample groups."
      },
      sgpd: {
        name: "Sample Group Description Box",
        description: "Describes sample groups referenced by sbgp."
      },
      saiz: {
        name: "Sample Auxiliary Information Sizes Box",
        description: "Stores sizes for auxiliary per-sample information."
      },
      saio: {
        name: "Sample Auxiliary Information Offsets Box",
        description: "Stores offsets for auxiliary per-sample information."
      },
      mvhd: {
        name: "Movie Header Box",
        description: "Movie-level timescale, duration, rate, volume, and next track ID."
      },
      mvex: {
        name: "Movie Extends Box",
        description: "Declares that the file uses movie fragments and default fragment settings."
      },
      mehd: {
        name: "Movie Extends Header Box",
        description: "Stores overall fragmented movie duration."
      },
      trex: {
        name: "Track Extends Box",
        description: "Default sample description, duration, size, and flags for fragments."
      },
      moof: {
        name: "Movie Fragment Box",
        description: "Container for one fragmented MP4 fragment's track runs."
      },
      mfhd: {
        name: "Movie Fragment Header Box",
        description: "Fragment sequence number."
      },
      traf: {
        name: "Track Fragment Box",
        description: "Container for one track's fragment metadata and sample runs."
      },
      tfhd: {
        name: "Track Fragment Header Box",
        description: "Track ID and default sample values for following trun boxes."
      },
      tfdt: {
        name: "Track Fragment Decode Time Box",
        description: "Base decode time for the first sample in a track fragment."
      },
      trun: {
        name: "Track Run Box",
        description: "Per-sample duration, size, flags, composition offsets, and data offset in fragments."
      },
      mfra: {
        name: "Movie Fragment Random Access Box",
        description: "Container for random-access indices into movie fragments."
      },
      tfra: {
        name: "Track Fragment Random Access Box",
        description: "Random-access entries for one track in fragmented media."
      },
      mfro: {
        name: "Movie Fragment Random Access Offset Box",
        description: "Stores the size of the mfra box for backward lookup."
      },
      meta: {
        name: "Metadata Box",
        description: "Container for timed or file-level metadata."
      },
      ilst: {
        name: "Item List Box",
        description: "QuickTime/iTunes metadata item list."
      },
      udta: {
        name: "User Data Box",
        description: "Container for user data and metadata."
      },
      tref: {
        name: "Track Reference Box",
        description: "Container for references between tracks."
      },
      sinf: {
        name: "Protection Scheme Information Box",
        description: "Container for encryption or protection scheme metadata."
      },
      frma: {
        name: "Original Format Box",
        description: "Stores the original unprotected sample entry format."
      },
      schm: {
        name: "Scheme Type Box",
        description: "Identifies the protection or restricted scheme."
      },
      schi: {
        name: "Scheme Information Box",
        description: "Container for scheme-specific protection information."
      },
      avcC: {
        name: "AVC Configuration Box",
        description: "H.264/AVC decoder configuration including profile, level, SPS/PPS, and NAL length size."
      },
      hvcC: {
        name: "HEVC Configuration Box",
        description: "H.265/HEVC decoder configuration including profile, level, VPS/SPS/PPS, and NAL length size."
      },
      esds: {
        name: "Elementary Stream Descriptor Box",
        description: "MPEG-4 descriptors, commonly carrying AAC AudioSpecificConfig for mp4a tracks."
      },
      pasp: {
        name: "Pixel Aspect Ratio Box",
        description: "Horizontal and vertical pixel aspect ratio spacing."
      },
      colr: {
        name: "Colour Information Box",
        description: "Color primaries, transfer characteristics, matrix coefficients, or ICC profile."
      },
      clap: {
        name: "Clean Aperture Box",
        description: "Clean aperture dimensions and offsets for display cropping."
      },
      btrt: {
        name: "Bitrate Box",
        description: "Buffer size, maximum bitrate, and average bitrate hints."
      },
      avc1: {
        name: "AVC Sample Entry",
        description: "H.264/AVC video sample entry using avcC codec configuration."
      },
      avc3: {
        name: "AVC3 Sample Entry",
        description: "H.264/AVC video sample entry where parameter sets may appear in samples."
      },
      hvc1: {
        name: "HEVC Sample Entry",
        description: "H.265/HEVC video sample entry using hvcC codec configuration."
      },
      hev1: {
        name: "HEV1 Sample Entry",
        description: "H.265/HEVC sample entry where parameter sets may appear in samples."
      },
      mp4a: {
        name: "MPEG-4 Audio Sample Entry",
        description: "Audio sample entry, commonly AAC with esds decoder configuration."
      },
      ap4h: {
        name: "Apple ProRes 4444 Sample Entry",
        description: "Apple ProRes 4444 video sample entry."
      }
    };

    const I18N = {
      en: {
        "app.title": "MP4/fMP4 Media Analyzer",
        "app.subtitle": "Single-file parser for boxes, samples, fragments, and video frame types.",
        "language.label": "Language",
        "status.initial": "Open or drop a media file to begin.",
        "status.cancelling": "Cancelling...",
        "status.failed": "Failed: {message}",
        "status.scanComplete": "Frame type scan complete",
        "status.scanStopped": "Scan stopped: {message}",
        "status.reading": "Reading {name}",
        "status.parsingBoxes": "Parsing boxes",
        "status.buildingTrackModel": "Building track model",
        "status.structureParsed": "Structure parsed",
        "status.scanningVideoSamples": "Scanning video samples",
        "button.open": "Open file",
        "button.scan": "Scan frame types",
        "button.cancel": "Cancel",
        "button.exportJson": "Export JSON",
        "button.exportCsv": "Export CSV",
        "button.clear": "Clear",
        "preview.loadedMedia": "Loaded media",
        "tab.summary": "Summary",
        "tab.boxes": "Boxes",
        "tab.tracks": "Tracks",
        "tab.frames": "Frames",
        "tab.metrics": "Metrics",
        "tab.fragments": "Fragments",
        "tab.warnings": "Warnings",
        "empty.summary": "Open or drop a file to inspect MP4 structure and samples.",
        "empty.boxDetailInitial": "Open a file, then select a box from the tree.",
        "empty.selectBox": "Select a box from the tree.",
        "empty.noTracks": "No tracks parsed.",
        "empty.metrics": "Open a file to inspect bitrate and FPS metrics.",
        "empty.noFragments": "No fragments parsed.",
        "empty.noWarnings": "No warnings.",
        "empty.parsingStructure": "Parsing structure...",
        "empty.parsingMetrics": "Parsing metrics...",
        "empty.noTrackMetrics": "No track available for metrics.",
        "empty.noSamplesForTrack": "No samples found for Track {trackId}.",
        "empty.noChartPoints": "No chart points.",
        "empty.noFrameTypeData": "No frame type data.",
        "empty.noSamples": "No samples.",
        "empty.noMoof": "No moof boxes found.",
        "drop.title": "Drop media file to analyze",
        "drop.subtitle": "Release anywhere in this window for MP4, M4V, or MOV parsing.",
        "boxes.treeTitle": "Box Tree",
        "boxes.detailTitle": "Box detail",
        "boxes.parsedFields": "Parsed fields",
        "boxes.unknownType": "Unknown or unregistered box type",
        "boxes.noDescription": "No built-in description is available for this box type. It may be vendor-specific, private, or not yet mapped by this analyzer.",
        "field.track": "Track",
        "field.frameType": "Frame type",
        "field.sync": "Sync",
        "field.minSize": "Min size",
        "field.maxSize": "Max size",
        "field.warningOnly": "Warning only",
        "field.view": "View",
        "field.movingAverageSamples": "Moving average samples",
        "field.chartPoints": "Chart points",
        "option.all": "All",
        "option.syncOnly": "Sync only",
        "option.nonSyncOnly": "Non-sync only",
        "option.noTrack": "No track",
        "view.graph": "Graph",
        "view.table": "Table",
        "aria.frameViewMode": "Frame view mode",
        "aria.seekFrame": "Seek to track {trackId} sample {sampleIndex} at {time}",
        "graph.axisTitle": "Time / frame",
        "unit.bytes": "bytes",
        "unit.max": "max {value}",
        "count.rows": "{count} rows",
        "column.index": "Index",
        "column.track": "Track",
        "column.handler": "Handler",
        "column.codec": "Codec",
        "column.duration": "Duration",
        "column.media": "Media",
        "column.samples": "Samples",
        "column.avgBitrate": "Avg bitrate",
        "column.fpsSamples": "FPS / samples/s",
        "column.avgSample": "Avg sample",
        "column.codecConfig": "Codec config",
        "column.offset": "Offset",
        "column.size": "Size",
        "column.sync": "Sync",
        "column.type": "Type",
        "column.chunkFragment": "Chunk/Frag",
        "column.time": "Time",
        "value.yes": "yes",
        "value.no": "no",
        "value.none": "none",
        "value.unknownMime": "unknown MIME type",
        "value.unknown": "unknown",
        "value.mixed": "mixed",
        "value.audio": "audio",
        "value.sample": "sample",
        "value.notAvailable": "n/a",
        "summary.fileSize": "File size",
        "summary.tracks": "Tracks",
        "summary.videoTracks": "Video tracks",
        "summary.fragments": "Fragments",
        "summary.samples": "Samples",
        "summary.avcTracks": "AVC tracks",
        "summary.hevcTracks": "HEVC tracks",
        "summary.aacTracks": "AAC tracks",
        "summary.warnings": "Warnings",
        "summary.note": "AVC/HEVC frame type scan reads each sample range and parses video NAL slice headers. Other codecs are shown as sample metadata only.",
        "metrics.track": "Track",
        "metrics.avgFps": "Avg FPS",
        "metrics.samplesPerSecond": "Samples/s",
        "metrics.peakMaBitrate": "Peak MA bitrate",
        "metrics.peakMaFps": "Peak MA FPS",
        "metrics.medianSample": "Median sample",
        "metrics.syncSamples": "Sync samples",
        "metrics.bitrateMovingAverage": "Bitrate moving average",
        "metrics.fpsMovingAverage": "FPS moving average",
        "metrics.sampleRateMovingAverage": "Sample rate moving average",
        "metrics.chartMax": "max {value} · {count} plotted points",
        "metrics.frameTypeDistribution": "Frame type distribution",
        "metrics.largestSamples": "Largest samples",
        "fragments.title": "Fragments",
        "warning.prefixTrackSample": "Track {trackId} sample {sampleIndex}: {warning}",
        "box.field.type": "type",
        "box.field.description": "description",
        "box.field.path": "path",
        "box.field.offset": "offset",
        "box.field.size": "size",
        "box.field.headerSize": "header size",
        "box.field.children": "children",
        "box.field.warnings": "warnings"
      },
      ko: {
        "app.title": "MP4/fMP4 미디어 분석기",
        "app.subtitle": "박스, 샘플, 프래그먼트, 영상 프레임 타입을 분석하는 단일 파일 파서입니다.",
        "language.label": "언어",
        "status.initial": "미디어 파일을 열거나 끌어다 놓으세요.",
        "status.cancelling": "취소 중...",
        "status.failed": "실패: {message}",
        "status.scanComplete": "프레임 타입 스캔 완료",
        "status.scanStopped": "스캔 중단: {message}",
        "status.reading": "{name} 읽는 중",
        "status.parsingBoxes": "박스 파싱 중",
        "status.buildingTrackModel": "트랙 모델 구성 중",
        "status.structureParsed": "구조 파싱 완료",
        "status.scanningVideoSamples": "비디오 샘플 스캔 중",
        "button.open": "파일 열기",
        "button.scan": "프레임 타입 스캔",
        "button.cancel": "취소",
        "button.exportJson": "JSON 내보내기",
        "button.exportCsv": "CSV 내보내기",
        "button.clear": "초기화",
        "preview.loadedMedia": "로드된 미디어",
        "tab.summary": "요약",
        "tab.boxes": "박스",
        "tab.tracks": "트랙",
        "tab.frames": "프레임",
        "tab.metrics": "메트릭",
        "tab.fragments": "프래그먼트",
        "tab.warnings": "경고",
        "empty.summary": "파일을 열거나 드롭하면 MP4 구조와 샘플을 검사합니다.",
        "empty.boxDetailInitial": "파일을 연 뒤 트리에서 박스를 선택하세요.",
        "empty.selectBox": "트리에서 박스를 선택하세요.",
        "empty.noTracks": "파싱된 트랙이 없습니다.",
        "empty.metrics": "파일을 열면 bitrate와 FPS 메트릭을 확인할 수 있습니다.",
        "empty.noFragments": "파싱된 프래그먼트가 없습니다.",
        "empty.noWarnings": "경고가 없습니다.",
        "empty.parsingStructure": "구조 파싱 중...",
        "empty.parsingMetrics": "메트릭 계산 중...",
        "empty.noTrackMetrics": "메트릭을 표시할 트랙이 없습니다.",
        "empty.noSamplesForTrack": "Track {trackId}의 샘플이 없습니다.",
        "empty.noChartPoints": "차트 포인트가 없습니다.",
        "empty.noFrameTypeData": "프레임 타입 데이터가 없습니다.",
        "empty.noSamples": "샘플이 없습니다.",
        "empty.noMoof": "moof 박스가 없습니다.",
        "drop.title": "분석할 미디어 파일 드롭",
        "drop.subtitle": "이 창 어디에서든 MP4, M4V, MOV 파일을 놓으면 파싱합니다.",
        "boxes.treeTitle": "박스 트리",
        "boxes.detailTitle": "박스 상세",
        "boxes.parsedFields": "파싱된 필드",
        "boxes.unknownType": "알 수 없거나 등록되지 않은 박스 타입",
        "boxes.noDescription": "이 박스 타입에 대한 내장 설명이 없습니다. 벤더 전용, private, 또는 아직 매핑되지 않은 타입일 수 있습니다.",
        "field.track": "트랙",
        "field.frameType": "프레임 타입",
        "field.sync": "싱크",
        "field.minSize": "최소 크기",
        "field.maxSize": "최대 크기",
        "field.warningOnly": "경고만",
        "field.view": "보기",
        "field.movingAverageSamples": "이동평균 샘플 수",
        "field.chartPoints": "차트 포인트",
        "option.all": "전체",
        "option.syncOnly": "싱크만",
        "option.nonSyncOnly": "비싱크만",
        "option.noTrack": "트랙 없음",
        "view.graph": "그래프",
        "view.table": "테이블",
        "aria.frameViewMode": "프레임 보기 방식",
        "aria.seekFrame": "Track {trackId} sample {sampleIndex}의 {time} 위치로 이동",
        "graph.axisTitle": "시간 / 프레임",
        "unit.bytes": "bytes",
        "unit.max": "최대 {value}",
        "count.rows": "{count} rows",
        "column.index": "인덱스",
        "column.track": "트랙",
        "column.handler": "핸들러",
        "column.codec": "코덱",
        "column.duration": "길이",
        "column.media": "미디어",
        "column.samples": "샘플",
        "column.avgBitrate": "평균 bitrate",
        "column.fpsSamples": "FPS / 샘플/s",
        "column.avgSample": "평균 샘플",
        "column.codecConfig": "코덱 설정",
        "column.offset": "오프셋",
        "column.size": "크기",
        "column.sync": "싱크",
        "column.type": "타입",
        "column.chunkFragment": "청크/프래그먼트",
        "column.time": "시간",
        "value.yes": "예",
        "value.no": "아니오",
        "value.none": "없음",
        "value.unknownMime": "알 수 없는 MIME type",
        "value.unknown": "알 수 없음",
        "value.mixed": "혼합",
        "value.audio": "오디오",
        "value.sample": "샘플",
        "value.notAvailable": "n/a",
        "summary.fileSize": "파일 크기",
        "summary.tracks": "트랙",
        "summary.videoTracks": "비디오 트랙",
        "summary.fragments": "프래그먼트",
        "summary.samples": "샘플",
        "summary.avcTracks": "AVC 트랙",
        "summary.hevcTracks": "HEVC 트랙",
        "summary.aacTracks": "AAC 트랙",
        "summary.warnings": "경고",
        "summary.note": "AVC/HEVC 프레임 타입 스캔은 각 샘플 범위를 읽고 영상 NAL slice header를 파싱합니다. 다른 코덱은 샘플 메타데이터까지만 표시합니다.",
        "metrics.track": "트랙",
        "metrics.avgFps": "평균 FPS",
        "metrics.samplesPerSecond": "샘플/s",
        "metrics.peakMaBitrate": "최대 이동평균 bitrate",
        "metrics.peakMaFps": "최대 이동평균 FPS",
        "metrics.medianSample": "중앙값 샘플",
        "metrics.syncSamples": "싱크 샘플",
        "metrics.bitrateMovingAverage": "Bitrate 이동평균",
        "metrics.fpsMovingAverage": "FPS 이동평균",
        "metrics.sampleRateMovingAverage": "샘플 레이트 이동평균",
        "metrics.chartMax": "최대 {value} · 표시 포인트 {count}개",
        "metrics.frameTypeDistribution": "프레임 타입 분포",
        "metrics.largestSamples": "가장 큰 샘플",
        "fragments.title": "프래그먼트",
        "warning.prefixTrackSample": "Track {trackId} sample {sampleIndex}: {warning}",
        "box.field.type": "타입",
        "box.field.description": "설명",
        "box.field.path": "경로",
        "box.field.offset": "오프셋",
        "box.field.size": "크기",
        "box.field.headerSize": "헤더 크기",
        "box.field.children": "자식",
        "box.field.warnings": "경고"
      }
    };

    const BOX_TYPE_I18N = {
      ko: {
        ftyp: ["File Type Box / 파일 타입 박스", "MP4/QuickTime brand, minor version, compatible brand 목록을 선언합니다."],
        moov: ["Movie Box / 무비 박스", "트랙, 타이밍, 샘플 테이블을 담는 최상위 메타데이터 컨테이너입니다."],
        mdat: ["Media Data Box / 미디어 데이터 박스", "샘플 테이블이 참조하는 인코딩된 미디어 payload byte를 담습니다."],
        free: ["Free Space Box / 여유 공간 박스", "나중에 덮어쓸 수 있는 padding 또는 예약 byte입니다."],
        skip: ["Skip Box / 스킵 박스", "free와 유사한 padding 또는 무시되는 byte입니다."],
        wide: ["Wide Box / 와이드 박스", "large-size box 공간을 예약하기 위한 legacy QuickTime padding입니다."],
        uuid: ["UUID Box / UUID 박스", "16-byte UUID로 식별되는 벤더 전용 확장 박스입니다."],
        trak: ["Track Box / 트랙 박스", "비디오, 오디오, 자막 같은 하나의 미디어 트랙 컨테이너입니다."],
        tkhd: ["Track Header Box / 트랙 헤더 박스", "트랙 ID, duration, dimension, layer, display metadata를 담습니다."],
        edts: ["Edit Box / 편집 박스", "edit-list timing adjustment를 담는 컨테이너입니다."],
        elst: ["Edit List Box / 편집 리스트 박스", "presentation timeline 구간을 media timeline 범위에 매핑합니다."],
        mdia: ["Media Box / 미디어 박스", "media timing, handler, media information 컨테이너입니다."],
        mdhd: ["Media Header Box / 미디어 헤더 박스", "트랙 media timescale, duration, language를 담습니다."],
        hdlr: ["Handler Reference Box / 핸들러 참조 박스", "vide, soun 같은 트랙 handler type을 선언합니다."],
        minf: ["Media Information Box / 미디어 정보 박스", "media-specific header, data reference, sample table 컨테이너입니다."],
        vmhd: ["Video Media Header Box / 비디오 미디어 헤더 박스", "graphics mode 같은 비디오 트랙 표시 메타데이터입니다."],
        smhd: ["Sound Media Header Box / 사운드 미디어 헤더 박스", "balance 같은 오디오 트랙 표시 메타데이터입니다."],
        hmhd: ["Hint Media Header Box / 힌트 미디어 헤더 박스", "스트리밍용 hint track 메타데이터입니다."],
        nmhd: ["Null Media Header Box / 널 미디어 헤더 박스", "특수 media header가 없는 트랙용 generic media header입니다."],
        dinf: ["Data Information Box / 데이터 정보 박스", "미디어 데이터가 위치한 곳을 설명하는 컨테이너입니다."],
        dref: ["Data Reference Box / 데이터 참조 박스", "sample entry가 사용하는 data reference 목록입니다."],
        url: ["Data Entry URL Box / 데이터 엔트리 URL 박스", "URL data reference입니다. MP4에서는 보통 self-contained입니다."],
        urn: ["Data Entry URN Box / 데이터 엔트리 URN 박스", "미디어 데이터를 위한 URN data reference입니다."],
        stbl: ["Sample Table Box / 샘플 테이블 박스", "샘플의 timing, size, chunk, offset 매핑 테이블 컨테이너입니다."],
        stsd: ["Sample Description Box / 샘플 설명 박스", "codec sample entry와 codec configuration box를 선언합니다."],
        stts: ["Decoding Time to Sample Box / 디코딩 시간-샘플 박스", "샘플을 decode duration과 DTS 진행에 매핑합니다."],
        ctts: ["Composition Time to Sample Box / 합성 시간-샘플 박스", "reordered frame을 위해 DTS 대비 PTS offset을 저장합니다."],
        stsc: ["Sample to Chunk Box / 샘플-청크 박스", "sample run을 chunk number와 samples-per-chunk에 매핑합니다."],
        stsz: ["Sample Size Box / 샘플 크기 박스", "샘플별 byte size 또는 하나의 constant sample size를 저장합니다."],
        stz2: ["Compact Sample Size Box / compact 샘플 크기 박스", "4/8/16-bit compact per-sample size를 저장합니다."],
        stco: ["Chunk Offset Box / 청크 오프셋 박스", "미디어 데이터 chunk의 32-bit file offset을 저장합니다."],
        co64: ["64-bit Chunk Offset Box / 64-bit 청크 오프셋 박스", "미디어 데이터 chunk의 64-bit file offset을 저장합니다."],
        stss: ["Sync Sample Box / 싱크 샘플 박스", "일반적으로 keyframe인 random-access sync sample 목록입니다."],
        stsh: ["Shadow Sync Sample Box / shadow sync 샘플 박스", "non-sync sample을 shadow sync sample에 매핑합니다."],
        sdtp: ["Sample Dependency Type Box / 샘플 의존성 타입 박스", "random access와 prediction을 위한 per-sample dependency flag를 저장합니다."],
        sbgp: ["Sample to Group Box / 샘플-그룹 박스", "sample range를 sample group에 매핑합니다."],
        sgpd: ["Sample Group Description Box / 샘플 그룹 설명 박스", "sbgp가 참조하는 sample group을 설명합니다."],
        saiz: ["Sample Auxiliary Information Sizes Box / 샘플 보조 정보 크기 박스", "per-sample auxiliary information size를 저장합니다."],
        saio: ["Sample Auxiliary Information Offsets Box / 샘플 보조 정보 오프셋 박스", "per-sample auxiliary information offset을 저장합니다."],
        mvhd: ["Movie Header Box / 무비 헤더 박스", "movie-level timescale, duration, rate, volume, next track ID를 담습니다."],
        mvex: ["Movie Extends Box / 무비 확장 박스", "movie fragment 사용과 기본 fragment 설정을 선언합니다."],
        mehd: ["Movie Extends Header Box / 무비 확장 헤더 박스", "전체 fragmented movie duration을 저장합니다."],
        trex: ["Track Extends Box / 트랙 확장 박스", "fragment의 기본 sample description, duration, size, flag를 담습니다."],
        moof: ["Movie Fragment Box / 무비 프래그먼트 박스", "fragmented MP4의 한 fragment에 대한 track run 컨테이너입니다."],
        mfhd: ["Movie Fragment Header Box / 무비 프래그먼트 헤더 박스", "fragment sequence number를 담습니다."],
        traf: ["Track Fragment Box / 트랙 프래그먼트 박스", "한 트랙의 fragment metadata와 sample run 컨테이너입니다."],
        tfhd: ["Track Fragment Header Box / 트랙 프래그먼트 헤더 박스", "track ID와 뒤따르는 trun box의 기본 sample 값을 담습니다."],
        tfdt: ["Track Fragment Decode Time Box / 트랙 프래그먼트 디코드 시간 박스", "track fragment 첫 샘플의 base decode time입니다."],
        trun: ["Track Run Box / 트랙 런 박스", "fragment 내 per-sample duration, size, flag, composition offset, data offset을 담습니다."],
        mfra: ["Movie Fragment Random Access Box / 무비 프래그먼트 랜덤 액세스 박스", "movie fragment에 대한 random-access index 컨테이너입니다."],
        tfra: ["Track Fragment Random Access Box / 트랙 프래그먼트 랜덤 액세스 박스", "한 트랙의 fragmented media random-access entry입니다."],
        mfro: ["Movie Fragment Random Access Offset Box / 무비 프래그먼트 랜덤 액세스 오프셋 박스", "backward lookup을 위해 mfra box size를 저장합니다."],
        meta: ["Metadata Box / 메타데이터 박스", "timed 또는 file-level metadata 컨테이너입니다."],
        ilst: ["Item List Box / 아이템 리스트 박스", "QuickTime/iTunes metadata item list입니다."],
        udta: ["User Data Box / 사용자 데이터 박스", "user data와 metadata 컨테이너입니다."],
        tref: ["Track Reference Box / 트랙 참조 박스", "트랙 사이의 reference를 담는 컨테이너입니다."],
        sinf: ["Protection Scheme Information Box / 보호 스킴 정보 박스", "encryption 또는 protection scheme metadata 컨테이너입니다."],
        frma: ["Original Format Box / 원본 포맷 박스", "보호되기 전 원래 sample entry format을 저장합니다."],
        schm: ["Scheme Type Box / 스킴 타입 박스", "protection 또는 restricted scheme을 식별합니다."],
        schi: ["Scheme Information Box / 스킴 정보 박스", "scheme-specific protection information 컨테이너입니다."],
        avcC: ["AVC Configuration Box / AVC 설정 박스", "profile, level, SPS/PPS, NAL length size를 포함한 H.264/AVC decoder configuration입니다."],
        hvcC: ["HEVC Configuration Box / HEVC 설정 박스", "profile, level, VPS/SPS/PPS, NAL length size를 포함한 H.265/HEVC decoder configuration입니다."],
        esds: ["Elementary Stream Descriptor Box / elementary stream descriptor 박스", "주로 mp4a 트랙의 AAC AudioSpecificConfig를 담는 MPEG-4 descriptor입니다."],
        pasp: ["Pixel Aspect Ratio Box / 픽셀 종횡비 박스", "horizontal/vertical pixel aspect ratio spacing입니다."],
        colr: ["Colour Information Box / 색상 정보 박스", "color primaries, transfer characteristics, matrix coefficients 또는 ICC profile입니다."],
        clap: ["Clean Aperture Box / clean aperture 박스", "display cropping용 clean aperture dimension과 offset입니다."],
        btrt: ["Bitrate Box / bitrate 박스", "buffer size, maximum bitrate, average bitrate hint를 담습니다."],
        avc1: ["AVC Sample Entry / AVC 샘플 엔트리", "avcC codec configuration을 사용하는 H.264/AVC video sample entry입니다."],
        avc3: ["AVC3 Sample Entry / AVC3 샘플 엔트리", "parameter set이 sample 안에 나타날 수 있는 H.264/AVC video sample entry입니다."],
        hvc1: ["HEVC Sample Entry / HEVC 샘플 엔트리", "hvcC codec configuration을 사용하는 H.265/HEVC video sample entry입니다."],
        hev1: ["HEV1 Sample Entry / HEV1 샘플 엔트리", "parameter set이 sample 안에 나타날 수 있는 H.265/HEVC sample entry입니다."],
        mp4a: ["MPEG-4 Audio Sample Entry / MPEG-4 오디오 샘플 엔트리", "주로 esds decoder configuration을 가진 AAC audio sample entry입니다."],
        ap4h: ["Apple ProRes 4444 Sample Entry / Apple ProRes 4444 샘플 엔트리", "Apple ProRes 4444 video sample entry입니다."]
      }
    };

    let activeLanguage = "en";

    function t(key, values) {
      const dictionary = I18N[activeLanguage] || I18N.en;
      let text = dictionary[key] || I18N.en[key] || key;
      for (const [name, value] of Object.entries(values || {})) {
        text = text.replace(new RegExp("\\{" + name + "\\}", "g"), String(value));
      }
      return text;
    }

    function toBig(value) {
      return typeof value === "bigint" ? value : BigInt(value);
    }

    function toSafeNumber(value, context) {
      const bigValue = toBig(value);
      if (bigValue > MAX_SAFE_BIGINT) {
        throw new Error(context + " is too large for browser File.slice(): " + bigValue.toString());
      }
      return Number(bigValue);
    }

    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }

    function formatBytes(value) {
      const numberValue = Number(value);
      if (!Number.isFinite(numberValue)) return String(value);
      const units = ["B", "KB", "MB", "GB", "TB"];
      let current = numberValue;
      let unitIndex = 0;
      while (current >= 1024 && unitIndex < units.length - 1) {
        current /= 1024;
        unitIndex += 1;
      }
      return (unitIndex === 0 ? current.toFixed(0) : current.toFixed(2)) + " " + units[unitIndex];
    }

    function formatBitsPerSecond(value) {
      const numberValue = Number(value);
      if (!Number.isFinite(numberValue)) return t("value.notAvailable");
      const units = ["bps", "Kbps", "Mbps", "Gbps"];
      let current = numberValue;
      let unitIndex = 0;
      while (current >= 1000 && unitIndex < units.length - 1) {
        current /= 1000;
        unitIndex += 1;
      }
      return (unitIndex === 0 ? current.toFixed(0) : current.toFixed(2)) + " " + units[unitIndex];
    }

    function formatPreviewBitrate(value) {
      const numberValue = Number(value);
      if (!Number.isFinite(numberValue) || numberValue <= 0) return "";
      if (numberValue < 10_000_000) return formatSignificantDigits(numberValue / 1000, 4) + " kbps";
      return formatSignificantDigits(numberValue / 1_000_000, 4) + " Mbps";
    }

    function formatSignificantDigits(value, significantDigits) {
      const numberValue = Number(value);
      if (!Number.isFinite(numberValue) || numberValue === 0) return "0";
      const decimals = Math.max(0, significantDigits - Math.floor(Math.log10(Math.abs(numberValue))) - 1);
      return numberValue.toFixed(Math.min(3, decimals));
    }

    function formatMetricNumber(value, digits) {
      const numberValue = Number(value);
      if (!Number.isFinite(numberValue)) return t("value.notAvailable");
      return numberValue.toFixed(digits);
    }

    function formatTime(value, timescale) {
      if (!timescale) return String(value);
      const seconds = Number(value) / Number(timescale);
      if (!Number.isFinite(seconds)) return String(value);
      return seconds.toFixed(6) + "s";
    }

    function hexByte(value) {
      return value.toString(16).padStart(2, "0");
    }

    function fourCcFromBytes(bytes, offset) {
      return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
    }

    function safeJsonReplacer(key, value) {
      if (typeof value === "bigint") return value.toString();
      if (key.endsWith("Big")) return undefined;
      return value;
    }

    class ByteCursor {
      constructor(bytes) {
        this.bytes = bytes;
        this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      }

      get length() {
        return this.bytes.byteLength;
      }

      ensure(offset, size) {
        return offset >= 0 && offset + size <= this.length;
      }

      uint8(offset) {
        if (!this.ensure(offset, 1)) throw new Error("Unexpected EOF at " + offset);
        return this.view.getUint8(offset);
      }

      uint16(offset) {
        if (!this.ensure(offset, 2)) throw new Error("Unexpected EOF at " + offset);
        return this.view.getUint16(offset, false);
      }

      int32(offset) {
        if (!this.ensure(offset, 4)) throw new Error("Unexpected EOF at " + offset);
        return this.view.getInt32(offset, false);
      }

      uint32(offset) {
        if (!this.ensure(offset, 4)) throw new Error("Unexpected EOF at " + offset);
        return this.view.getUint32(offset, false);
      }

      uint64(offset) {
        const high = this.uint32(offset);
        const low = this.uint32(offset + 4);
        return (BigInt(high) << 32n) + BigInt(low);
      }

      string(offset, length) {
        if (!this.ensure(offset, length)) throw new Error("Unexpected EOF at " + offset);
        let result = "";
        for (let index = 0; index < length; index += 1) {
          const byte = this.bytes[offset + index];
          if (byte === 0) break;
          result += String.fromCharCode(byte);
        }
        return result;
      }

      bytesAt(offset, length) {
        if (!this.ensure(offset, length)) throw new Error("Unexpected EOF at " + offset);
        return this.bytes.subarray(offset, offset + length);
      }
    }

    function readFullBoxHeader(cursor) {
      return {
        version: cursor.uint8(0),
        flags: (cursor.uint8(1) << 16) | (cursor.uint8(2) << 8) | cursor.uint8(3)
      };
    }

    class BlobRangeReader {
      constructor(file) {
        this.file = file;
        this.cache = new Map();
        this.cacheBytes = 0;
        this.cancelled = false;
      }

      cancel() {
        this.cancelled = true;
      }

      async readRange(offsetBig, lengthBig) {
        if (this.cancelled) throw new Error("Analysis cancelled.");
        const offset = toSafeNumber(offsetBig, "offset");
        const length = toSafeNumber(lengthBig, "length");
        if (length <= 0) return new Uint8Array(0);
        const result = new Uint8Array(length);
        let written = 0;
        let cursor = offset;
        const end = offset + length;
        while (cursor < end) {
          if (this.cancelled) throw new Error("Analysis cancelled.");
          const chunkIndex = Math.floor(cursor / CACHE_CHUNK_BYTES);
          const chunkStart = chunkIndex * CACHE_CHUNK_BYTES;
          const chunk = await this.readChunk(chunkIndex);
          const localStart = cursor - chunkStart;
          const copyLength = Math.min(chunk.byteLength - localStart, end - cursor);
          result.set(chunk.subarray(localStart, localStart + copyLength), written);
          written += copyLength;
          cursor += copyLength;
        }
        return result;
      }

      async readChunk(chunkIndex) {
        const cached = this.cache.get(chunkIndex);
        if (cached) {
          this.cache.delete(chunkIndex);
          this.cache.set(chunkIndex, cached);
          return cached.bytes;
        }
        const chunkStart = chunkIndex * CACHE_CHUNK_BYTES;
        const chunkEnd = Math.min(chunkStart + CACHE_CHUNK_BYTES, this.file.size);
        const buffer = await this.file.slice(chunkStart, chunkEnd).arrayBuffer();
        const bytes = new Uint8Array(buffer);
        this.cache.set(chunkIndex, { bytes, size: bytes.byteLength });
        this.cacheBytes += bytes.byteLength;
        this.evict();
        return bytes;
      }

      evict() {
        while (this.cacheBytes > MAX_CACHE_BYTES && this.cache.size > 1) {
          const firstKey = this.cache.keys().next().value;
          const item = this.cache.get(firstKey);
          this.cache.delete(firstKey);
          this.cacheBytes -= item.size;
        }
      }
    }

    async function readBoxPayload(reader, node, maxBytes) {
      const payloadSize = node.sizeBig - BigInt(node.headerSize);
      if (payloadSize < 0n) throw new Error("Invalid payload size for " + node.path);
      if (maxBytes && payloadSize > BigInt(maxBytes)) {
        node.warnings.push("Payload too large to parse inline: " + payloadSize.toString() + " bytes.");
        return null;
      }
      return reader.readRange(node.offsetBig + BigInt(node.headerSize), payloadSize);
    }

    async function parseBoxes(reader, startBig, endBig, parentPath, depth, warnings, progress) {
      const nodes = [];
      let offset = startBig;
      let guard = 0;
      while (offset + 8n <= endBig) {
        if (reader.cancelled) throw new Error("Analysis cancelled.");
        guard += 1;
        if (guard > 100000) {
          warnings.push("Stopped parsing " + parentPath + " after 100000 boxes.");
          break;
        }
        const remaining = endBig - offset;
        const headerProbe = await reader.readRange(offset, remaining < 32n ? remaining : 32n);
        if (headerProbe.byteLength < 8) break;
        const cursor = new ByteCursor(headerProbe);
        const size32 = cursor.uint32(0);
        const type = cursor.string(4, 4);
        let headerSize = 8;
        let boxSizeBig = BigInt(size32);
        if (size32 === 1) {
          if (headerProbe.byteLength < 16) {
            warnings.push("Truncated large-size box header at " + offset.toString());
            break;
          }
          boxSizeBig = cursor.uint64(8);
          headerSize = 16;
        } else if (size32 === 0) {
          boxSizeBig = endBig - offset;
        }
        if (type === "uuid") headerSize += 16;
        if (boxSizeBig < BigInt(headerSize)) {
          warnings.push("Invalid size for box " + type + " at " + offset.toString());
          break;
        }
        let boxEnd = offset + boxSizeBig;
        const nodeWarnings = [];
        if (boxEnd > endBig) {
          nodeWarnings.push("Box exceeds parent bounds. Clamped for parsing.");
          boxEnd = endBig;
        }
        const path = parentPath ? parentPath + "/" + type + "[" + nodes.length + "]" : type + "[" + nodes.length + "]";
        const node = {
          type,
          path,
          offset: offset.toString(),
          offsetBig: offset,
          size: boxSizeBig.toString(),
          sizeBig: boxSizeBig,
          headerSize,
          children: [],
          fields: {},
          warnings: nodeWarnings
        };
        await parseKnownBoxFields(reader, node);
        const containerSkip = FULLBOX_CONTAINER_OFFSETS.get(type) || 0;
        const childStart = offset + BigInt(headerSize + containerSkip);
        if ((CONTAINER_BOXES.has(type) || FULLBOX_CONTAINER_OFFSETS.has(type)) && depth < 24 && childStart < boxEnd) {
          node.children = await parseBoxes(reader, childStart, boxEnd, path, depth + 1, warnings, progress);
        }
        nodes.push(node);
        if (progress && depth === 0) progress("Parsing boxes", Number(offset * 100n / endBig));
        if (boxSizeBig === 0n) break;
        offset = offset + boxSizeBig;
      }
      return nodes;
    }

    async function parseKnownBoxFields(reader, node) {
      if (node.type === "mdat") {
        node.fields.dataStart = (node.offsetBig + BigInt(node.headerSize)).toString();
        node.fields.dataSize = (node.sizeBig - BigInt(node.headerSize)).toString();
        return;
      }
      if (!PARSED_FIELD_BOXES.has(node.type)) return;
      const smallBoxMax = 128 * 1024 * 1024;
      const payload = await readBoxPayload(reader, node, smallBoxMax);
      if (!payload) return;
      const cursor = new ByteCursor(payload);
      try {
        if (node.type === "ftyp") parseFtyp(cursor, node);
        else if (node.type === "mvhd") parseMvhd(cursor, node);
        else if (node.type === "tkhd") parseTkhd(cursor, node);
        else if (node.type === "mdhd") parseMdhd(cursor, node);
        else if (node.type === "hdlr") parseHdlr(cursor, node);
        else if (node.type === "stsd") parseStsd(cursor, node);
        else if (node.type === "stts") parseStts(cursor, node);
        else if (node.type === "ctts") parseCtts(cursor, node);
        else if (node.type === "stss") parseStss(cursor, node);
        else if (node.type === "stsc") parseStsc(cursor, node);
        else if (node.type === "stsz") parseStsz(cursor, node);
        else if (node.type === "stz2") parseStz2(cursor, node);
        else if (node.type === "stco") parseStco(cursor, node, false);
        else if (node.type === "co64") parseStco(cursor, node, true);
        else if (node.type === "trex") parseTrex(cursor, node);
        else if (node.type === "mfhd") parseMfhd(cursor, node);
        else if (node.type === "tfhd") parseTfhd(cursor, node);
        else if (node.type === "tfdt") parseTfdt(cursor, node);
        else if (node.type === "trun") parseTrun(cursor, node);
      } catch (error) {
        node.warnings.push("Could not parse fields: " + error.message);
      }
    }

    function parseFtyp(cursor, node) {
      if (cursor.length < 8) return;
      const brands = [];
      for (let offset = 8; offset + 4 <= cursor.length; offset += 4) brands.push(cursor.string(offset, 4));
      node.fields = {
        majorBrand: cursor.string(0, 4),
        minorVersion: cursor.uint32(4),
        compatibleBrands: brands
      };
    }

    function parseMvhd(cursor, node) {
      const full = readFullBoxHeader(cursor);
      const timescale = full.version === 1 ? cursor.uint32(20) : cursor.uint32(12);
      const duration = full.version === 1 ? cursor.uint64(24).toString() : cursor.uint32(16).toString();
      node.fields = { version: full.version, flags: full.flags, timescale, duration };
    }

    function parseTkhd(cursor, node) {
      const full = readFullBoxHeader(cursor);
      const trackId = full.version === 1 ? cursor.uint32(20) : cursor.uint32(12);
      const duration = full.version === 1 ? cursor.uint64(28).toString() : cursor.uint32(20).toString();
      const widthRaw = cursor.uint32(cursor.length - 8);
      const heightRaw = cursor.uint32(cursor.length - 4);
      node.fields = {
        version: full.version,
        flags: full.flags,
        trackId,
        duration,
        width: widthRaw / 65536,
        height: heightRaw / 65536
      };
    }

    function parseMdhd(cursor, node) {
      const full = readFullBoxHeader(cursor);
      const timescale = full.version === 1 ? cursor.uint32(20) : cursor.uint32(12);
      const duration = full.version === 1 ? cursor.uint64(24).toString() : cursor.uint32(16).toString();
      const languageOffset = full.version === 1 ? 32 : 20;
      let language = "";
      if (cursor.ensure(languageOffset, 2)) {
        const packed = cursor.uint16(languageOffset);
        language = String.fromCharCode(((packed >> 10) & 31) + 0x60, ((packed >> 5) & 31) + 0x60, (packed & 31) + 0x60);
      }
      node.fields = { version: full.version, flags: full.flags, timescale, duration, language };
    }

    function parseHdlr(cursor, node) {
      const full = readFullBoxHeader(cursor);
      const handlerType = cursor.string(8, 4);
      const name = cursor.length > 24 ? cursor.string(24, cursor.length - 24) : "";
      node.fields = { version: full.version, flags: full.flags, handlerType, name };
    }

    function parseStsd(cursor, node) {
      const full = readFullBoxHeader(cursor);
      const entryCount = cursor.uint32(4);
      const entries = [];
      let offset = 8;
      for (let index = 0; index < entryCount && offset + 8 <= cursor.length; index += 1) {
        const entryStart = offset;
        const entrySize = cursor.uint32(offset);
        const format = cursor.string(offset + 4, 4);
        const entry = { index: index + 1, format, size: entrySize, boxes: [] };
        const entryEnd = Math.min(entryStart + entrySize, cursor.length);
        if (VIDEO_SAMPLE_ENTRIES.has(format) && entryStart + 86 <= entryEnd) {
          entry.dataReferenceIndex = cursor.uint16(entryStart + 14);
          entry.width = cursor.uint16(entryStart + 32);
          entry.height = cursor.uint16(entryStart + 34);
          entry.depth = cursor.uint16(entryStart + 82);
          parseSampleEntryChildren(cursor, entryStart + 86, entryEnd, entry);
        } else if (AUDIO_SAMPLE_ENTRIES.has(format) && entryStart + 36 <= entryEnd) {
          entry.dataReferenceIndex = cursor.uint16(entryStart + 14);
          entry.channelCount = cursor.uint16(entryStart + 24);
          entry.sampleSize = cursor.uint16(entryStart + 26);
          entry.sampleRate = cursor.uint32(entryStart + 32) / 65536;
          parseSampleEntryChildren(cursor, entryStart + 36, entryEnd, entry);
        } else {
          parseSampleEntryChildren(cursor, entryStart + 16, entryEnd, entry);
        }
        entries.push(entry);
        if (entrySize <= 0) break;
        offset += entrySize;
      }
      node.fields = { version: full.version, flags: full.flags, entryCount, entries };
    }

    function parseSampleEntryChildren(cursor, start, end, entry) {
      let offset = start;
      while (offset + 8 <= end) {
        const childSize = cursor.uint32(offset);
        const childType = cursor.string(offset + 4, 4);
        if (childSize < 8 || offset + childSize > end) break;
        const child = { type: childType, size: childSize };
        if (childType === "avcC") {
          child.fields = parseAvcC(cursor.bytesAt(offset + 8, childSize - 8));
          entry.avcConfig = child.fields;
        } else if (childType === "hvcC") {
          child.fields = parseHevcC(cursor.bytesAt(offset + 8, childSize - 8));
          entry.hevcConfig = child.fields;
        } else if (childType === "esds") {
          child.fields = parseEsds(cursor.bytesAt(offset + 8, childSize - 8));
          entry.audioConfig = child.fields.audioConfig || null;
          entry.esds = child.fields;
        } else if (childType === "pasp" && childSize >= 16) {
          child.fields = { hSpacing: cursor.uint32(offset + 8), vSpacing: cursor.uint32(offset + 12) };
        } else if (childType === "colr") {
          child.fields = { colorType: cursor.string(offset + 8, 4) };
        }
        entry.boxes.push(child);
        offset += childSize;
      }
    }

    function parseAvcC(bytes) {
      const cursor = new ByteCursor(bytes);
      if (cursor.length < 7) return { error: "avcC too short" };
      const profile = cursor.uint8(1);
      const compatibility = cursor.uint8(2);
      const level = cursor.uint8(3);
      const nalLengthSize = (cursor.uint8(4) & 0x03) + 1;
      const spsCount = cursor.uint8(5) & 0x1f;
      const sps = [];
      let offset = 6;
      for (let index = 0; index < spsCount && offset + 2 <= cursor.length; index += 1) {
        const length = cursor.uint16(offset);
        offset += 2;
        if (offset + length > cursor.length) break;
        sps.push({ length, previewHex: Array.from(cursor.bytesAt(offset, Math.min(length, 10))).map(hexByte).join("") });
        offset += length;
      }
      let ppsCount = 0;
      const pps = [];
      if (offset < cursor.length) {
        ppsCount = cursor.uint8(offset);
        offset += 1;
        for (let index = 0; index < ppsCount && offset + 2 <= cursor.length; index += 1) {
          const length = cursor.uint16(offset);
          offset += 2;
          if (offset + length > cursor.length) break;
          pps.push({ length, previewHex: Array.from(cursor.bytesAt(offset, Math.min(length, 10))).map(hexByte).join("") });
          offset += length;
        }
      }
      return {
        configurationVersion: cursor.uint8(0),
        profile,
        compatibility,
        level,
        codecString: "avc1." + hexByte(profile) + hexByte(compatibility) + hexByte(level),
        nalLengthSize,
        spsCount: sps.length,
        ppsCount: pps.length,
        sps,
        pps
      };
    }

    function parseHevcC(bytes) {
      const cursor = new ByteCursor(bytes);
      if (cursor.length < 23) return { error: "hvcC too short" };
      const profileTierByte = cursor.uint8(1);
      const generalProfileSpace = profileTierByte >> 6;
      const generalTierFlag = Boolean(profileTierByte & 0x20);
      const generalProfileIdc = profileTierByte & 0x1f;
      const generalProfileCompatibilityFlags = cursor.uint32(2);
      let constraintHex = "";
      for (let offset = 6; offset < 12; offset += 1) constraintHex += hexByte(cursor.uint8(offset));
      const generalLevelIdc = cursor.uint8(12);
      const minSpatialSegmentationIdc = cursor.uint16(13) & 0x0fff;
      const parallelismType = cursor.uint8(15) & 0x03;
      const chromaFormat = cursor.uint8(16) & 0x03;
      const bitDepthLuma = (cursor.uint8(17) & 0x07) + 8;
      const bitDepthChroma = (cursor.uint8(18) & 0x07) + 8;
      const averageFrameRate = cursor.uint16(19);
      const packed = cursor.uint8(21);
      const constantFrameRate = packed >> 6;
      const numTemporalLayers = (packed >> 3) & 0x07;
      const temporalIdNested = Boolean(packed & 0x04);
      const nalLengthSize = (packed & 0x03) + 1;
      const arrayCount = cursor.uint8(22);
      const arrays = [];
      let offset = 23;
      for (let arrayIndex = 0; arrayIndex < arrayCount && offset + 3 <= cursor.length; arrayIndex += 1) {
        const arrayHeader = cursor.uint8(offset);
        offset += 1;
        const arrayCompleteness = Boolean(arrayHeader & 0x80);
        const nalUnitType = arrayHeader & 0x3f;
        const nalUnitCount = cursor.uint16(offset);
        offset += 2;
        const nalUnits = [];
        for (let nalIndex = 0; nalIndex < nalUnitCount && offset + 2 <= cursor.length; nalIndex += 1) {
          const nalUnitLength = cursor.uint16(offset);
          offset += 2;
          if (offset + nalUnitLength > cursor.length) break;
          nalUnits.push({
            length: nalUnitLength,
            previewHex: Array.from(cursor.bytesAt(offset, Math.min(nalUnitLength, 12))).map(hexByte).join("")
          });
          offset += nalUnitLength;
        }
        arrays.push({ arrayCompleteness, nalUnitType, nalUnitTypeName: hevcNalTypeName(nalUnitType), nalUnitCount: nalUnits.length, nalUnits });
      }
      return {
        configurationVersion: cursor.uint8(0),
        codecString: "hvc1.profile" + generalProfileIdc + ".L" + generalLevelIdc,
        generalProfileSpace,
        generalTierFlag,
        generalProfileIdc,
        generalProfileCompatibilityFlags,
        generalConstraintIndicatorFlags: constraintHex,
        generalLevelIdc,
        minSpatialSegmentationIdc,
        parallelismType,
        chromaFormat,
        bitDepthLuma,
        bitDepthChroma,
        averageFrameRate,
        constantFrameRate,
        numTemporalLayers,
        temporalIdNested,
        nalLengthSize,
        arrayCount: arrays.length,
        arrays
      };
    }

    function parseEsds(bytes) {
      const cursor = new ByteCursor(bytes);
      if (cursor.length < 4) return { error: "esds too short" };
      const full = readFullBoxHeader(cursor);
      const descriptors = parseDescriptors(cursor, 4, cursor.length, 0);
      const decoderConfig = findDescriptor(descriptors, 0x04);
      const decoderSpecificInfo = findDescriptor(descriptors, 0x05);
      const audioConfig = decoderSpecificInfo ? parseAudioSpecificConfig(decoderSpecificInfo.bytes) : null;
      if (audioConfig && decoderConfig && decoderConfig.objectTypeIndication === 0x40) {
        audioConfig.codecString = "mp4a.40." + audioConfig.audioObjectType;
      }
      return {
        version: full.version,
        flags: full.flags,
        descriptors,
        objectTypeIndication: decoderConfig ? decoderConfig.objectTypeIndication : null,
        streamType: decoderConfig ? decoderConfig.streamType : null,
        bufferSizeDB: decoderConfig ? decoderConfig.bufferSizeDB : null,
        maxBitrate: decoderConfig ? decoderConfig.maxBitrate : null,
        avgBitrate: decoderConfig ? decoderConfig.avgBitrate : null,
        audioConfig
      };
    }

    function parseDescriptors(cursor, start, end, depth) {
      const descriptors = [];
      let offset = start;
      while (offset + 2 <= end && depth < 8) {
        const tag = cursor.uint8(offset);
        const sizeInfo = readDescriptorSize(cursor, offset + 1, end);
        if (!sizeInfo) break;
        const headerSize = 1 + sizeInfo.bytesRead;
        const dataStart = offset + headerSize;
        const dataEnd = dataStart + sizeInfo.size;
        if (dataEnd > end) break;
        const descriptor = {
          tag,
          tagName: descriptorTagName(tag),
          size: sizeInfo.size,
          bytes: Array.from(cursor.bytesAt(dataStart, sizeInfo.size))
        };
        parseDescriptorFields(cursor, descriptor, dataStart, dataEnd, depth);
        descriptors.push(descriptor);
        offset = dataEnd;
      }
      return descriptors;
    }

    function readDescriptorSize(cursor, offset, end) {
      let size = 0;
      let bytesRead = 0;
      while (offset + bytesRead < end && bytesRead < 4) {
        const byte = cursor.uint8(offset + bytesRead);
        size = (size << 7) | (byte & 0x7f);
        bytesRead += 1;
        if ((byte & 0x80) === 0) return { size, bytesRead };
      }
      return null;
    }

    function parseDescriptorFields(cursor, descriptor, start, end, depth) {
      if (descriptor.tag === 0x03 && start + 3 <= end) {
        descriptor.esId = cursor.uint16(start);
        const flags = cursor.uint8(start + 2);
        descriptor.flags = flags;
        let childStart = start + 3;
        if (flags & 0x80) childStart += 2;
        if (flags & 0x40 && childStart < end) childStart += 1 + cursor.uint8(childStart);
        if (flags & 0x20) childStart += 2;
        descriptor.children = parseDescriptors(cursor, childStart, end, depth + 1);
      } else if (descriptor.tag === 0x04 && start + 13 <= end) {
        descriptor.objectTypeIndication = cursor.uint8(start);
        descriptor.streamType = cursor.uint8(start + 1) >> 2;
        descriptor.upStream = Boolean(cursor.uint8(start + 1) & 0x02);
        descriptor.bufferSizeDB = (cursor.uint8(start + 2) << 16) | (cursor.uint8(start + 3) << 8) | cursor.uint8(start + 4);
        descriptor.maxBitrate = cursor.uint32(start + 5);
        descriptor.avgBitrate = cursor.uint32(start + 9);
        descriptor.children = parseDescriptors(cursor, start + 13, end, depth + 1);
      }
    }

    function findDescriptor(descriptors, tag) {
      for (const descriptor of descriptors || []) {
        if (descriptor.tag === tag) return descriptor;
        const found = findDescriptor(descriptor.children || [], tag);
        if (found) return found;
      }
      return null;
    }

    function descriptorTagName(tag) {
      const names = {
        0x03: "ES_Descriptor",
        0x04: "DecoderConfigDescriptor",
        0x05: "DecoderSpecificInfo",
        0x06: "SLConfigDescriptor"
      };
      return names[tag] || "Descriptor 0x" + tag.toString(16);
    }

    function parseAudioSpecificConfig(bytesLike) {
      const bytes = bytesLike instanceof Uint8Array ? bytesLike : new Uint8Array(bytesLike);
      const bitReader = new BitReader(bytes);
      let audioObjectType = readAudioObjectType(bitReader);
      let samplingFrequencyIndex = bitReader.readBits(4);
      let samplingFrequency = samplingFrequencyIndex === 0x0f ? bitReader.readBits(24) : AUDIO_SAMPLE_RATES[samplingFrequencyIndex] || null;
      const channelConfiguration = bitReader.readBits(4);
      let extensionAudioObjectType = null;
      let extensionSamplingFrequency = null;
      if (audioObjectType === 5 || audioObjectType === 29) {
        extensionAudioObjectType = audioObjectType;
        samplingFrequencyIndex = bitReader.readBits(4);
        extensionSamplingFrequency = samplingFrequencyIndex === 0x0f ? bitReader.readBits(24) : AUDIO_SAMPLE_RATES[samplingFrequencyIndex] || null;
        audioObjectType = readAudioObjectType(bitReader);
      }
      return {
        audioObjectType,
        audioObjectTypeName: AUDIO_OBJECT_TYPE_NAMES[audioObjectType] || "Audio object type " + audioObjectType,
        samplingFrequencyIndex,
        samplingFrequency,
        channelConfiguration,
        channelDescription: describeChannelConfiguration(channelConfiguration),
        extensionAudioObjectType,
        extensionSamplingFrequency
      };
    }

    function readAudioObjectType(bitReader) {
      const value = bitReader.readBits(5);
      return value === 31 ? 32 + bitReader.readBits(6) : value;
    }

    function describeChannelConfiguration(channelConfiguration) {
      const names = {
        0: "defined in program config element",
        1: "mono",
        2: "stereo",
        3: "3 channels",
        4: "4 channels",
        5: "5 channels",
        6: "5.1 channels",
        7: "7.1 channels"
      };
      return names[channelConfiguration] || channelConfiguration + " channels";
    }

    function parseStts(cursor, node) {
      const full = readFullBoxHeader(cursor);
      const entryCount = cursor.uint32(4);
      const entries = [];
      let offset = 8;
      for (let index = 0; index < entryCount && offset + 8 <= cursor.length; index += 1) {
        entries.push({ sampleCount: cursor.uint32(offset), sampleDelta: cursor.uint32(offset + 4) });
        offset += 8;
      }
      node.fields = { version: full.version, flags: full.flags, entryCount, entries };
    }

    function parseCtts(cursor, node) {
      const full = readFullBoxHeader(cursor);
      const entryCount = cursor.uint32(4);
      const entries = [];
      let offset = 8;
      for (let index = 0; index < entryCount && offset + 8 <= cursor.length; index += 1) {
        entries.push({
          sampleCount: cursor.uint32(offset),
          sampleOffset: full.version === 1 ? cursor.int32(offset + 4) : cursor.uint32(offset + 4)
        });
        offset += 8;
      }
      node.fields = { version: full.version, flags: full.flags, entryCount, entries };
    }

    function parseStss(cursor, node) {
      const full = readFullBoxHeader(cursor);
      const entryCount = cursor.uint32(4);
      const samples = [];
      let offset = 8;
      for (let index = 0; index < entryCount && offset + 4 <= cursor.length; index += 1) {
        samples.push(cursor.uint32(offset));
        offset += 4;
      }
      node.fields = { version: full.version, flags: full.flags, entryCount, samples };
    }

    function parseStsc(cursor, node) {
      const full = readFullBoxHeader(cursor);
      const entryCount = cursor.uint32(4);
      const entries = [];
      let offset = 8;
      for (let index = 0; index < entryCount && offset + 12 <= cursor.length; index += 1) {
        entries.push({
          firstChunk: cursor.uint32(offset),
          samplesPerChunk: cursor.uint32(offset + 4),
          sampleDescriptionIndex: cursor.uint32(offset + 8)
        });
        offset += 12;
      }
      node.fields = { version: full.version, flags: full.flags, entryCount, entries };
    }

    function parseStsz(cursor, node) {
      const full = readFullBoxHeader(cursor);
      const sampleSize = cursor.uint32(4);
      const sampleCount = cursor.uint32(8);
      const sizes = [];
      let offset = 12;
      if (sampleSize === 0) {
        for (let index = 0; index < sampleCount && offset + 4 <= cursor.length; index += 1) {
          sizes.push(cursor.uint32(offset));
          offset += 4;
        }
      }
      node.fields = { version: full.version, flags: full.flags, sampleSize, sampleCount, sizes };
    }

    function parseStz2(cursor, node) {
      const full = readFullBoxHeader(cursor);
      const fieldSize = cursor.uint8(7);
      const sampleCount = cursor.uint32(8);
      const sizes = [];
      let offset = 12;
      if (fieldSize === 4) {
        for (let index = 0; index < sampleCount && offset < cursor.length; index += 1) {
          const byte = cursor.uint8(offset);
          sizes.push(index % 2 === 0 ? byte >> 4 : byte & 0x0f);
          if (index % 2 === 1) offset += 1;
        }
      } else if (fieldSize === 8) {
        for (let index = 0; index < sampleCount && offset < cursor.length; index += 1) {
          sizes.push(cursor.uint8(offset));
          offset += 1;
        }
      } else if (fieldSize === 16) {
        for (let index = 0; index < sampleCount && offset + 2 <= cursor.length; index += 1) {
          sizes.push(cursor.uint16(offset));
          offset += 2;
        }
      }
      node.fields = { version: full.version, flags: full.flags, fieldSize, sampleCount, sizes };
    }

    function parseStco(cursor, node, isCo64) {
      const full = readFullBoxHeader(cursor);
      const entryCount = cursor.uint32(4);
      const offsets = [];
      let offset = 8;
      for (let index = 0; index < entryCount; index += 1) {
        if (isCo64) {
          if (offset + 8 > cursor.length) break;
          const value = cursor.uint64(offset);
          offsets.push(value <= MAX_SAFE_BIGINT ? Number(value) : value.toString());
          offset += 8;
        } else {
          if (offset + 4 > cursor.length) break;
          offsets.push(cursor.uint32(offset));
          offset += 4;
        }
      }
      node.fields = { version: full.version, flags: full.flags, entryCount, offsets };
    }

    function parseTrex(cursor, node) {
      const full = readFullBoxHeader(cursor);
      node.fields = {
        version: full.version,
        flags: full.flags,
        trackId: cursor.uint32(4),
        defaultSampleDescriptionIndex: cursor.uint32(8),
        defaultSampleDuration: cursor.uint32(12),
        defaultSampleSize: cursor.uint32(16),
        defaultSampleFlags: cursor.uint32(20)
      };
    }

    function parseMfhd(cursor, node) {
      const full = readFullBoxHeader(cursor);
      node.fields = { version: full.version, flags: full.flags, sequenceNumber: cursor.uint32(4) };
    }

    function parseTfhd(cursor, node) {
      const full = readFullBoxHeader(cursor);
      let offset = 8;
      const fields = { version: full.version, flags: full.flags, trackId: cursor.uint32(4) };
      if (full.flags & 0x000001) {
        fields.baseDataOffset = cursor.uint64(offset).toString();
        offset += 8;
      }
      if (full.flags & 0x000002) {
        fields.sampleDescriptionIndex = cursor.uint32(offset);
        offset += 4;
      }
      if (full.flags & 0x000008) {
        fields.defaultSampleDuration = cursor.uint32(offset);
        offset += 4;
      }
      if (full.flags & 0x000010) {
        fields.defaultSampleSize = cursor.uint32(offset);
        offset += 4;
      }
      if (full.flags & 0x000020) {
        fields.defaultSampleFlags = cursor.uint32(offset);
        offset += 4;
      }
      fields.durationIsEmpty = Boolean(full.flags & 0x010000);
      fields.defaultBaseIsMoof = Boolean(full.flags & 0x020000);
      node.fields = fields;
    }

    function parseTfdt(cursor, node) {
      const full = readFullBoxHeader(cursor);
      node.fields = {
        version: full.version,
        flags: full.flags,
        baseMediaDecodeTime: full.version === 1 ? cursor.uint64(4).toString() : cursor.uint32(4).toString()
      };
    }

    function parseTrun(cursor, node) {
      const full = readFullBoxHeader(cursor);
      const sampleCount = cursor.uint32(4);
      let offset = 8;
      const fields = { version: full.version, flags: full.flags, sampleCount, samples: [] };
      if (full.flags & 0x000001) {
        fields.dataOffset = cursor.int32(offset);
        offset += 4;
      }
      if (full.flags & 0x000004) {
        fields.firstSampleFlags = cursor.uint32(offset);
        offset += 4;
      }
      for (let index = 0; index < sampleCount && offset <= cursor.length; index += 1) {
        const sample = {};
        if (full.flags & 0x000100) {
          if (offset + 4 > cursor.length) break;
          sample.duration = cursor.uint32(offset);
          offset += 4;
        }
        if (full.flags & 0x000200) {
          if (offset + 4 > cursor.length) break;
          sample.size = cursor.uint32(offset);
          offset += 4;
        }
        if (full.flags & 0x000400) {
          if (offset + 4 > cursor.length) break;
          sample.flags = cursor.uint32(offset);
          offset += 4;
        }
        if (full.flags & 0x000800) {
          if (offset + 4 > cursor.length) break;
          sample.compositionTimeOffset = full.version === 1 ? cursor.int32(offset) : cursor.uint32(offset);
          offset += 4;
        }
        fields.samples.push(sample);
      }
      node.fields = fields;
    }

    function findDescendants(node, type, results) {
      if (node.type === type) results.push(node);
      for (const child of node.children || []) findDescendants(child, type, results);
      return results;
    }

    function findFirst(node, type) {
      if (!node) return null;
      if (node.type === type) return node;
      for (const child of node.children || []) {
        const found = findFirst(child, type);
        if (found) return found;
      }
      return null;
    }

    function findChild(node, type) {
      return (node.children || []).find((child) => child.type === type) || null;
    }

    function flattenBoxes(nodes, result) {
      for (const node of nodes) {
        result.push(node);
        flattenBoxes(node.children || [], result);
      }
      return result;
    }

    function buildTrackModels(topBoxes, warnings) {
      const moov = topBoxes.find((box) => box.type === "moov");
      if (!moov) {
        warnings.push("No moov box found. Fragment-only streams without init segment are not supported.");
        return [];
      }
      const trexByTrack = new Map();
      for (const trex of findDescendants(moov, "trex", [])) trexByTrack.set(trex.fields.trackId, trex.fields);
      const tracks = [];
      for (const trak of (moov.children || []).filter((child) => child.type === "trak")) {
        const tkhd = findFirst(trak, "tkhd");
        const mdhd = findFirst(trak, "mdhd");
        const hdlr = findFirst(trak, "hdlr");
        const stsd = findFirst(trak, "stsd");
        const trackId = tkhd ? tkhd.fields.trackId : tracks.length + 1;
        const sampleEntry = stsd && stsd.fields.entries.length ? stsd.fields.entries[0] : null;
        const codec = sampleEntry ? sampleEntry.format : "unknown";
        const track = {
          trackId,
          handlerType: hdlr ? hdlr.fields.handlerType : "unknown",
          codec,
          timescale: mdhd ? mdhd.fields.timescale : 0,
          duration: mdhd ? mdhd.fields.duration : "0",
          width: sampleEntry && sampleEntry.width ? sampleEntry.width : (tkhd ? tkhd.fields.width : 0),
          height: sampleEntry && sampleEntry.height ? sampleEntry.height : (tkhd ? tkhd.fields.height : 0),
          channelCount: sampleEntry && sampleEntry.channelCount ? sampleEntry.channelCount : 0,
          sampleRate: sampleEntry && sampleEntry.sampleRate ? sampleEntry.sampleRate : 0,
          sampleCount: 0,
          avcConfig: sampleEntry && sampleEntry.avcConfig ? sampleEntry.avcConfig : null,
          hevcConfig: sampleEntry && sampleEntry.hevcConfig ? sampleEntry.hevcConfig : null,
          audioConfig: sampleEntry && sampleEntry.audioConfig ? sampleEntry.audioConfig : null,
          esds: sampleEntry && sampleEntry.esds ? sampleEntry.esds : null,
          sampleEntry,
          trex: trexByTrack.get(trackId) || null,
          stbl: findFirst(trak, "stbl"),
          warnings: []
        };
        if ((codec === "avc1" || codec === "avc3") && !track.avcConfig) {
          track.warnings.push("AVC sample entry has no avcC box.");
        }
        if ((codec === "hvc1" || codec === "hev1") && !track.hevcConfig) {
          track.warnings.push("HEVC sample entry has no hvcC box.");
        }
        if (codec === "mp4a" && !track.audioConfig) {
          track.warnings.push("AAC sample entry has no esds AudioSpecificConfig.");
        }
        tracks.push(track);
      }
      return tracks;
    }

    function buildNormalSamples(tracks, warnings) {
      const rows = [];
      for (const track of tracks) {
        if (!track.stbl) continue;
        const stsz = findFirst(track.stbl, "stsz");
        const stz2 = findFirst(track.stbl, "stz2");
        const stsc = findFirst(track.stbl, "stsc");
        const stco = findFirst(track.stbl, "stco") || findFirst(track.stbl, "co64");
        const stts = findFirst(track.stbl, "stts");
        if ((!stsz && !stz2) || !stsc || !stco || !stts) continue;
        const sampleCount = stsz ? stsz.fields.sampleCount : stz2.fields.sampleCount;
        if (!sampleCount) continue;
        const sizes = stsz ? (stsz.fields.sampleSize ? Array(sampleCount).fill(stsz.fields.sampleSize) : stsz.fields.sizes) : stz2.fields.sizes;
        const dtsDurations = expandTiming(stts.fields.entries, sampleCount);
        const ctts = findFirst(track.stbl, "ctts");
        const compositionOffsets = ctts ? expandCompositionOffsets(ctts.fields.entries, sampleCount) : Array(sampleCount).fill(0);
        const stss = findFirst(track.stbl, "stss");
        const syncSet = stss ? new Set(stss.fields.samples) : null;
        const offsets = computeSampleOffsets(stsc.fields.entries, stco.fields.offsets, sizes, sampleCount, track, warnings);
        for (let index = 0; index < sampleCount; index += 1) {
          const timing = dtsDurations[index] || { dts: 0, duration: 0 };
          const cts = compositionOffsets[index] || 0;
          rows.push({
            trackId: track.trackId,
            sampleIndex: index + 1,
            offset: offsets[index] ? offsets[index].offset.toString() : "",
            size: sizes[index] || 0,
            dts: timing.dts,
            pts: timing.dts + cts,
            duration: timing.duration,
            isSync: syncSet ? syncSet.has(index + 1) : true,
            frameType: getDefaultSampleFrameType(track),
            nalTypes: getDefaultSampleTags(track),
            chunkIndex: offsets[index] ? offsets[index].chunkIndex : "",
            fragmentIndex: "",
            warnings: offsets[index] ? [] : ["Sample offset missing."]
          });
        }
        track.sampleCount += sampleCount;
      }
      return rows;
    }

    function expandTiming(entries, sampleCount) {
      const result = new Array(sampleCount);
      let sampleIndex = 0;
      let dts = 0;
      for (const entry of entries) {
        for (let count = 0; count < entry.sampleCount && sampleIndex < sampleCount; count += 1) {
          result[sampleIndex] = { dts, duration: entry.sampleDelta };
          dts += entry.sampleDelta;
          sampleIndex += 1;
        }
      }
      return result;
    }

    function expandCompositionOffsets(entries, sampleCount) {
      const result = new Array(sampleCount).fill(0);
      let sampleIndex = 0;
      for (const entry of entries) {
        for (let count = 0; count < entry.sampleCount && sampleIndex < sampleCount; count += 1) {
          result[sampleIndex] = entry.sampleOffset;
          sampleIndex += 1;
        }
      }
      return result;
    }

    function computeSampleOffsets(stscEntries, chunkOffsets, sizes, sampleCount, track, warnings) {
      const result = new Array(sampleCount);
      let sampleIndex = 0;
      let stscIndex = 0;
      for (let chunkIndex = 1; chunkIndex <= chunkOffsets.length && sampleIndex < sampleCount; chunkIndex += 1) {
        while (stscIndex + 1 < stscEntries.length && chunkIndex >= stscEntries[stscIndex + 1].firstChunk) {
          stscIndex += 1;
        }
        const entry = stscEntries[stscIndex];
        let currentOffset;
        try {
          currentOffset = BigInt(chunkOffsets[chunkIndex - 1]);
        } catch (error) {
          warnings.push("Track " + track.trackId + " has an unsafe chunk offset.");
          break;
        }
        for (let sampleInChunk = 0; sampleInChunk < entry.samplesPerChunk && sampleIndex < sampleCount; sampleInChunk += 1) {
          result[sampleIndex] = { offset: currentOffset, chunkIndex };
          currentOffset += BigInt(sizes[sampleIndex] || 0);
          sampleIndex += 1;
        }
      }
      return result;
    }

    function buildFragmentSamples(topBoxes, tracks, warnings) {
      const rows = [];
      const sampleIndexByTrack = new Map(tracks.map((track) => [track.trackId, track.sampleCount]));
      const trackById = new Map(tracks.map((track) => [track.trackId, track]));
      const topLevel = topBoxes.slice().sort((a, b) => Number(a.offsetBig - b.offsetBig));
      let fragmentIndex = 0;
      for (const moof of topLevel.filter((box) => box.type === "moof")) {
        fragmentIndex += 1;
        const mdat = findFollowingMdat(topLevel, moof);
        const fallbackDataStart = mdat ? mdat.offsetBig + BigInt(mdat.headerSize) : moof.offsetBig + moof.sizeBig;
        let trafDataCursor = fallbackDataStart;
        for (const traf of (moof.children || []).filter((child) => child.type === "traf")) {
          const tfhd = findChild(traf, "tfhd");
          const tfdt = findChild(traf, "tfdt");
          if (!tfhd) {
            warnings.push("Fragment " + fragmentIndex + " has traf without tfhd.");
            continue;
          }
          const track = trackById.get(tfhd.fields.trackId);
          if (!track) {
            warnings.push("Fragment " + fragmentIndex + " references unknown track " + tfhd.fields.trackId + ".");
            continue;
          }
          const trex = track.trex || {};
          let decodeTime = tfdt ? Number(tfdt.fields.baseMediaDecodeTime) : 0;
          let baseDataOffset;
          if (tfhd.fields.baseDataOffset) baseDataOffset = BigInt(tfhd.fields.baseDataOffset);
          else if (tfhd.fields.defaultBaseIsMoof) baseDataOffset = moof.offsetBig;
          else baseDataOffset = trafDataCursor;
          let localDataCursor = trafDataCursor;
          for (const trun of (traf.children || []).filter((child) => child.type === "trun")) {
            const run = trun.fields;
            let dataCursor = run.dataOffset !== undefined ? baseDataOffset + BigInt(run.dataOffset) : localDataCursor;
            for (let index = 0; index < run.samples.length; index += 1) {
              const sample = run.samples[index];
              const duration = sample.duration || tfhd.fields.defaultSampleDuration || trex.defaultSampleDuration || 0;
              const size = sample.size || tfhd.fields.defaultSampleSize || trex.defaultSampleSize || 0;
              let flags = sample.flags;
              if (flags === undefined && index === 0 && run.firstSampleFlags !== undefined) flags = run.firstSampleFlags;
              if (flags === undefined) flags = tfhd.fields.defaultSampleFlags !== undefined ? tfhd.fields.defaultSampleFlags : trex.defaultSampleFlags;
              const ctsOffset = sample.compositionTimeOffset || 0;
              const nextIndex = (sampleIndexByTrack.get(track.trackId) || 0) + 1;
              sampleIndexByTrack.set(track.trackId, nextIndex);
              rows.push({
                trackId: track.trackId,
                sampleIndex: nextIndex,
                offset: dataCursor.toString(),
                size,
                dts: decodeTime,
                pts: decodeTime + ctsOffset,
                duration,
                isSync: sampleFlagsToSync(flags),
                frameType: getDefaultSampleFrameType(track),
                nalTypes: getDefaultSampleTags(track),
                chunkIndex: "",
                fragmentIndex,
                warnings: size ? [] : ["Fragment sample size is missing."]
              });
              dataCursor += BigInt(size || 0);
              decodeTime += duration;
            }
            localDataCursor = dataCursor;
            trafDataCursor = dataCursor;
          }
        }
      }
      for (const track of tracks) track.sampleCount = sampleIndexByTrack.get(track.trackId) || track.sampleCount;
      return rows;
    }

    function findFollowingMdat(topLevel, moof) {
      const moofEnd = moof.offsetBig + moof.sizeBig;
      return topLevel.find((box) => box.type === "mdat" && box.offsetBig >= moofEnd) || null;
    }

    function sampleFlagsToSync(flags) {
      if (flags === undefined || flags === null) return false;
      return (flags & 0x00010000) === 0;
    }

    function getDefaultSampleFrameType(track) {
      if (!track) return "";
      if (track.codec === "mp4a") return "AAC";
      if (track.handlerType === "soun") return "audio";
      return "";
    }

    function getDefaultSampleTags(track) {
      if (!track) return [];
      if (track.codec === "mp4a") return ["AAC"];
      if (track.handlerType === "soun") return [track.codec];
      return [];
    }

    function removeEmulationPreventionBytes(bytes) {
      const output = [];
      let zeroCount = 0;
      for (const byte of bytes) {
        if (zeroCount >= 2 && byte === 0x03) {
          zeroCount = 0;
          continue;
        }
        output.push(byte);
        if (byte === 0) zeroCount += 1;
        else zeroCount = 0;
      }
      return new Uint8Array(output);
    }

    class BitReader {
      constructor(bytes) {
        this.bytes = bytes;
        this.bitOffset = 0;
      }

      readBit() {
        if (this.bitOffset >= this.bytes.byteLength * 8) throw new Error("Unexpected end of bitstream.");
        const byte = this.bytes[this.bitOffset >> 3];
        const bit = (byte >> (7 - (this.bitOffset & 7))) & 1;
        this.bitOffset += 1;
        return bit;
      }

      readBits(count) {
        let value = 0;
        for (let index = 0; index < count; index += 1) value = (value << 1) | this.readBit();
        return value;
      }

      readUE() {
        let zeros = 0;
        while (this.readBit() === 0) {
          zeros += 1;
          if (zeros > 31) throw new Error("Exp-Golomb code is too large.");
        }
        const suffix = zeros ? this.readBits(zeros) : 0;
        return (1 << zeros) - 1 + suffix;
      }
    }

    function classifySliceType(sliceType) {
      const normalized = sliceType % 5;
      if (normalized === 0) return "P";
      if (normalized === 1) return "B";
      if (normalized === 2) return "I";
      if (normalized === 3) return "SP";
      if (normalized === 4) return "SI";
      return "unknown";
    }

    function nalTypeName(type) {
      const names = {
        1: "non-IDR",
        5: "IDR",
        6: "SEI",
        7: "SPS",
        8: "PPS",
        9: "AUD"
      };
      return names[type] || String(type);
    }

    function hevcNalTypeName(type) {
      const names = {
        0: "TRAIL_N",
        1: "TRAIL_R",
        2: "TSA_N",
        3: "TSA_R",
        4: "STSA_N",
        5: "STSA_R",
        6: "RADL_N",
        7: "RADL_R",
        8: "RASL_N",
        9: "RASL_R",
        16: "BLA_W_LP",
        17: "BLA_W_RADL",
        18: "BLA_N_LP",
        19: "IDR_W_RADL",
        20: "IDR_N_LP",
        21: "CRA_NUT",
        32: "VPS",
        33: "SPS",
        34: "PPS",
        35: "AUD",
        39: "PREFIX_SEI",
        40: "SUFFIX_SEI"
      };
      return names[type] || "NAL " + type;
    }

    function parseAvcSample(bytes, nalLengthSize) {
      const nalTypes = [];
      const frameTypes = [];
      let hasIdr = false;
      let offset = 0;
      while (offset + nalLengthSize <= bytes.byteLength) {
        let nalLength = 0;
        for (let index = 0; index < nalLengthSize; index += 1) {
          nalLength = (nalLength << 8) | bytes[offset + index];
        }
        offset += nalLengthSize;
        if (!nalLength || offset + nalLength > bytes.byteLength) break;
        const nalHeader = bytes[offset];
        const nalType = nalHeader & 0x1f;
        nalTypes.push(nalTypeName(nalType));
        if (nalType === 5) hasIdr = true;
        if (nalType === 1 || nalType === 5) {
          try {
            const rbsp = removeEmulationPreventionBytes(bytes.subarray(offset + 1, offset + nalLength));
            const bitReader = new BitReader(rbsp);
            bitReader.readUE();
            const sliceType = bitReader.readUE();
            frameTypes.push(classifySliceType(sliceType));
          } catch (error) {
            if (nalType === 5) frameTypes.push("IDR");
          }
        }
        offset += nalLength;
      }
      const uniqueTypes = Array.from(new Set(frameTypes.filter(Boolean)));
      let frameType = "unknown";
      if (uniqueTypes.length === 1) frameType = uniqueTypes[0];
      else if (uniqueTypes.length > 1) frameType = "mixed(" + uniqueTypes.join("/") + ")";
      else if (hasIdr) frameType = "IDR";
      return { frameType, nalTypes };
    }

    function parseHevcSample(bytes, nalLengthSize) {
      const nalTypes = [];
      const frameTypes = [];
      let hasIrap = false;
      let offset = 0;
      while (offset + nalLengthSize <= bytes.byteLength) {
        let nalLength = 0;
        for (let index = 0; index < nalLengthSize; index += 1) {
          nalLength = (nalLength << 8) | bytes[offset + index];
        }
        offset += nalLengthSize;
        if (!nalLength || offset + nalLength > bytes.byteLength || nalLength < 2) break;
        const nalUnitType = (bytes[offset] >> 1) & 0x3f;
        nalTypes.push(hevcNalTypeName(nalUnitType));
        if (HEVC_IRAP_NAL_TYPES.has(nalUnitType)) hasIrap = true;
        if (nalUnitType <= 31) {
          try {
            const rbsp = removeEmulationPreventionBytes(bytes.subarray(offset + 2, offset + nalLength));
            const bitReader = new BitReader(rbsp);
            bitReader.readBit();
            if (HEVC_IRAP_NAL_TYPES.has(nalUnitType)) bitReader.readBit();
            bitReader.readUE();
            const sliceType = bitReader.readUE();
            frameTypes.push(classifyHevcSliceType(sliceType));
          } catch (error) {
            if (HEVC_IRAP_NAL_TYPES.has(nalUnitType)) frameTypes.push("I");
          }
        }
        offset += nalLength;
      }
      const uniqueTypes = Array.from(new Set(frameTypes.filter(Boolean)));
      let frameType = "unknown";
      if (uniqueTypes.length === 1) frameType = uniqueTypes[0];
      else if (uniqueTypes.length > 1) frameType = "mixed(" + uniqueTypes.join("/") + ")";
      else if (hasIrap) frameType = "I";
      return { frameType, nalTypes };
    }

    function classifyHevcSliceType(sliceType) {
      if (sliceType === 0) return "B";
      if (sliceType === 1) return "P";
      if (sliceType === 2) return "I";
      return "unknown";
    }

    function getFrameTypeScanner(track) {
      if ((track.codec === "avc1" || track.codec === "avc3") && track.avcConfig && track.avcConfig.nalLengthSize) {
        return {
          codec: "AVC",
          parse: (bytes) => parseAvcSample(bytes, track.avcConfig.nalLengthSize)
        };
      }
      if ((track.codec === "hvc1" || track.codec === "hev1") && track.hevcConfig && track.hevcConfig.nalLengthSize) {
        return {
          codec: "HEVC",
          parse: (bytes) => parseHevcSample(bytes, track.hevcConfig.nalLengthSize)
        };
      }
      return null;
    }

    async function scanFrameTypes(analysis, options) {
      const onProgress = options && options.onProgress ? options.onProgress : function () {};
      const reader = analysis.reader;
      const scannableTracks = new Map();
      for (const track of analysis.tracks) {
        const scanner = getFrameTypeScanner(track);
        if (scanner) scannableTracks.set(track.trackId, { track, scanner });
      }
      const rows = analysis.sampleRows.filter((row) => scannableTracks.has(row.trackId) && row.offset !== "" && row.size > 0);
      for (let index = 0; index < rows.length; index += 1) {
        if (reader.cancelled) throw new Error("Analysis cancelled.");
        const row = rows[index];
        const item = scannableTracks.get(row.trackId);
        try {
          const bytes = await reader.readRange(BigInt(row.offset), BigInt(row.size));
          const result = item.scanner.parse(bytes);
          row.frameType = result.frameType;
          row.nalTypes = result.nalTypes;
        } catch (error) {
          row.frameType = "unknown";
          row.warnings.push(item.scanner.codec + " scan failed: " + error.message);
        }
        if (index % 25 === 0 || index === rows.length - 1) {
          onProgress("Scanning video samples", rows.length ? Math.round((index + 1) * 100 / rows.length) : 100);
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
    }

    async function scanAvcFrameTypes(analysis, options) {
      return scanFrameTypes(analysis, options);
    }

    async function analyzeFile(file, options) {
      const onProgress = options && options.onProgress ? options.onProgress : function () {};
      const warnings = [];
      const reader = new BlobRangeReader(file);
      const fileSizeBig = BigInt(file.size);
      const topBoxes = await parseBoxes(reader, 0n, fileSizeBig, "", 0, warnings, onProgress);
      onProgress("Building track model", 66);
      const tracks = buildTrackModels(topBoxes, warnings);
      const normalRows = buildNormalSamples(tracks, warnings);
      const fragmentRows = buildFragmentSamples(topBoxes, tracks, warnings);
      const sampleRows = normalRows.concat(fragmentRows).sort((a, b) => {
        if (a.trackId !== b.trackId) return a.trackId - b.trackId;
        return a.sampleIndex - b.sampleIndex;
      });
      for (const track of tracks) {
        for (const warning of track.warnings) warnings.push("Track " + track.trackId + ": " + warning);
      }
      const allBoxes = flattenBoxes(topBoxes, []);
      const analysis = {
        file: { name: file.name || "unnamed", size: file.size, type: file.type || "" },
        reader,
        topBoxes,
        allBoxes,
        tracks,
        sampleRows,
        warnings
      };
      onProgress("Structure parsed", 100);
      return analysis;
    }

    function shouldAutoScan(analysis) {
      const videoRows = analysis.sampleRows.filter((row) => {
        const track = analysis.tracks.find((candidate) => candidate.trackId === row.trackId);
        return track && getFrameTypeScanner(track);
      });
      const totalBytes = videoRows.reduce((sum, row) => sum + (row.size || 0), 0);
      return videoRows.length > 0 && (videoRows.length <= 10000 || totalBytes <= 512 * 1024 * 1024);
    }

    function runParserSelfTests() {
      const results = [];
      const audioConfig = parseAudioSpecificConfig(new Uint8Array([0x12, 0x10]));
      assertSelfTest(audioConfig.audioObjectType === 2, "AAC LC object type", results);
      assertSelfTest(audioConfig.samplingFrequency === 44100, "AAC 44.1kHz sample rate", results);
      assertSelfTest(audioConfig.channelConfiguration === 2, "AAC stereo channel config", results);

      const esds = parseEsds(new Uint8Array([
        0x00, 0x00, 0x00, 0x00,
        0x03, 0x16, 0x00, 0x01, 0x00,
        0x04, 0x11, 0x40, 0x15, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
        0x05, 0x02, 0x12, 0x10
      ]));
      assertSelfTest(esds.audioConfig && esds.audioConfig.codecString === "mp4a.40.2", "esds mp4a.40.2", results);

      const avcSample = new Uint8Array([0x00, 0x00, 0x00, 0x02, 0x65, 0xb0]);
      assertSelfTest(parseAvcSample(avcSample, 4).frameType === "I", "AVC synthetic I frame", results);

      const hevcConfigBytes = new Uint8Array(23);
      hevcConfigBytes[0] = 1;
      hevcConfigBytes[1] = 1;
      hevcConfigBytes[12] = 93;
      hevcConfigBytes[21] = 3;
      const hevcConfig = parseHevcC(hevcConfigBytes);
      assertSelfTest(hevcConfig.nalLengthSize === 4, "HEVC hvcC NAL length size", results);

      const hevcSample = new Uint8Array([0x00, 0x00, 0x00, 0x03, 0x26, 0x01, 0xac]);
      assertSelfTest(parseHevcSample(hevcSample, 4).frameType === "I", "HEVC synthetic I frame", results);

      return { passed: true, results };
    }

    function assertSelfTest(condition, name, results) {
      if (!condition) throw new Error("Self-test failed: " + name);
      results.push({ name, passed: true });
    }

    const Core = {
      analyzeFile,
      scanFrameTypes,
      scanAvcFrameTypes,
      parseAvcSample,
      parseHevcSample,
      parseAudioSpecificConfig,
      parseEsds,
      parseHevcC,
      runParserSelfTests,
      shouldAutoScan,
      formatBytes
    };

    if (typeof window !== "undefined") {
      window.MP4AnalyzerCore = Core;
    }

    if (typeof document === "undefined" || !document.getElementById) return;

    const state = {
      analysis: null,
      language: activeLanguage,
      activeTab: "summary",
      selectedBox: null,
      selectedFrameKey: "",
      filteredRows: [],
      graphRows: [],
      frameViewMode: "table",
      graphMaxSize: 1,
      filePreviewUrl: "",
      dropHintHideTimer: 0,
      progressSourceLabel: "Open or drop a media file to begin.",
      progressRawLabel: t("status.initial"),
      progressPercentValue: 0,
      renderFrameRequest: 0
    };

    const elements = {
      fileInput: document.getElementById("fileInput"),
      languageSelect: document.getElementById("languageSelect"),
      openButton: document.getElementById("openButton"),
      scanButton: document.getElementById("scanButton"),
      cancelButton: document.getElementById("cancelButton"),
      exportJsonButton: document.getElementById("exportJsonButton"),
      exportCsvButton: document.getElementById("exportCsvButton"),
      mediaPreviewBar: document.getElementById("mediaPreviewBar"),
      filePreview: document.getElementById("filePreview"),
      mediaPreviewName: document.getElementById("mediaPreviewName"),
      mediaPreviewMeta: document.getElementById("mediaPreviewMeta"),
      dropOverlay: document.getElementById("dropOverlay"),
      boxTree: document.getElementById("boxTree"),
      boxDetail: document.getElementById("boxDetail"),
      summaryPanel: document.getElementById("summaryPanel"),
      boxesPanel: document.getElementById("boxesPanel"),
      tracksPanel: document.getElementById("tracksPanel"),
      framesPanel: document.getElementById("framesPanel"),
      metricsPanel: document.getElementById("metricsPanel"),
      fragmentsPanel: document.getElementById("fragmentsPanel"),
      warningsPanel: document.getElementById("warningsPanel"),
      progressText: document.getElementById("progressText"),
      progressPercent: document.getElementById("progressPercent"),
      progressFill: document.getElementById("progressFill"),
      trackFilter: document.getElementById("trackFilter"),
      typeFilter: document.getElementById("typeFilter"),
      syncFilter: document.getElementById("syncFilter"),
      minSizeFilter: document.getElementById("minSizeFilter"),
      maxSizeFilter: document.getElementById("maxSizeFilter"),
      warningOnlyFilter: document.getElementById("warningOnlyFilter"),
      clearFiltersButton: document.getElementById("clearFiltersButton"),
      frameGraphButton: document.getElementById("frameGraphButton"),
      frameTableButton: document.getElementById("frameTableButton"),
      frameCountText: document.getElementById("frameCountText"),
      frameGraphView: document.getElementById("frameGraphView"),
      frameTableView: document.getElementById("frameTableView"),
      frameScroller: document.getElementById("frameScroller"),
      frameSpacer: document.getElementById("frameSpacer"),
      graphAxisScale: document.getElementById("graphAxisScale"),
      graphAxisUnit: document.getElementById("graphAxisUnit"),
      graphScroller: document.getElementById("graphScroller"),
      graphSpacer: document.getElementById("graphSpacer"),
      metricsTrackFilter: document.getElementById("metricsTrackFilter"),
      metricsWindowInput: document.getElementById("metricsWindowInput"),
      metricsPointLimitInput: document.getElementById("metricsPointLimitInput"),
      metricsBody: document.getElementById("metricsBody")
    };

    window.MP4AnalyzerDevTools = {
      getAnalysis: () => state.analysis,
      getFilteredRows: () => state.filteredRows,
      getMetricsSummary: () => {
        const track = getSelectedMetricsTrack();
        if (!track) return null;
        const rows = getRowsForTrack(track.trackId);
        return buildTrackMetrics(track, rows, getMetricsWindowSize()).summary;
      },
      runSmokeTests: () => Core.runParserSelfTests(),
      summarize: () => {
        if (!state.analysis) return { loaded: false };
        return {
          loaded: true,
          file: state.analysis.file,
          tracks: state.analysis.tracks.map((track) => ({
            trackId: track.trackId,
            handlerType: track.handlerType,
            codec: track.codec,
            samples: track.sampleCount,
            avc: Boolean(track.avcConfig),
            hevc: Boolean(track.hevcConfig),
            aac: Boolean(track.audioConfig)
          })),
          sampleRows: state.analysis.sampleRows.length,
          warnings: state.analysis.warnings
        };
      }
    };

    elements.languageSelect.addEventListener("change", () => setLanguage(elements.languageSelect.value));
    elements.openButton.addEventListener("click", () => elements.fileInput.click());
    elements.fileInput.addEventListener("change", () => {
      const file = elements.fileInput.files && elements.fileInput.files[0];
      if (file) startAnalysis(file);
    });

    window.addEventListener("dragenter", handleWindowDragEnter, true);
    window.addEventListener("dragover", handleWindowDragOver, true);
    window.addEventListener("dragleave", handleWindowDragLeave, true);
    window.addEventListener("dragend", hideDropOverlay, true);
    window.addEventListener("drop", handleWindowDrop, true);

    for (const tabButton of document.querySelectorAll(".tab")) {
      tabButton.addEventListener("click", () => setActiveTab(tabButton.dataset.tab));
    }

    elements.cancelButton.addEventListener("click", () => {
      if (state.analysis && state.analysis.reader) state.analysis.reader.cancel();
      setProgress("Cancelling...", 0);
    });

    elements.scanButton.addEventListener("click", async () => {
      if (!state.analysis) return;
      await scanCurrentAnalysis();
    });

    elements.exportJsonButton.addEventListener("click", exportJson);
    elements.exportCsvButton.addEventListener("click", exportCsv);
    elements.frameScroller.addEventListener("scroll", scheduleFrameRender);
    elements.graphScroller.addEventListener("scroll", scheduleFrameRender);
    elements.frameSpacer.addEventListener("click", handleFrameRowPointerActivation);
    elements.graphSpacer.addEventListener("click", handleFrameRowPointerActivation);
    elements.metricsBody.addEventListener("click", handleFrameRowPointerActivation);
    elements.frameSpacer.addEventListener("keydown", handleFrameRowKeyboardActivation);
    elements.graphSpacer.addEventListener("keydown", handleFrameRowKeyboardActivation);
    elements.metricsBody.addEventListener("keydown", handleFrameRowKeyboardActivation);
    elements.frameGraphButton.addEventListener("click", () => setFrameViewMode("graph"));
    elements.frameTableButton.addEventListener("click", () => setFrameViewMode("table"));
    for (const input of [elements.trackFilter, elements.typeFilter, elements.syncFilter, elements.minSizeFilter, elements.maxSizeFilter, elements.warningOnlyFilter]) {
      input.addEventListener("input", renderFrames);
      input.addEventListener("change", renderFrames);
    }
    for (const input of [elements.metricsTrackFilter, elements.metricsWindowInput, elements.metricsPointLimitInput]) {
      input.addEventListener("input", renderMetrics);
      input.addEventListener("change", renderMetrics);
    }
    elements.clearFiltersButton.addEventListener("click", () => {
      elements.trackFilter.value = "";
      elements.typeFilter.value = "";
      elements.syncFilter.value = "";
      elements.minSizeFilter.value = "";
      elements.maxSizeFilter.value = "";
      elements.warningOnlyFilter.checked = false;
      renderFrames();
    });

    setLanguage(elements.languageSelect.value || "en");

    function setLanguage(language) {
      activeLanguage = I18N[language] ? language : "en";
      state.language = activeLanguage;
      elements.languageSelect.value = activeLanguage;
      applyStaticTranslations();
      setProgress(state.progressSourceLabel, state.progressPercentValue);
      refreshDynamicLanguage();
    }

    function applyStaticTranslations() {
      document.documentElement.lang = activeLanguage === "ko" ? "ko" : "en";
      document.title = t("app.title");
      for (const element of document.querySelectorAll("[data-i18n]")) {
        element.textContent = t(element.dataset.i18n);
      }
      for (const element of document.querySelectorAll("[data-i18n-aria-label]")) {
        element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel));
      }
      for (const element of document.querySelectorAll("[data-i18n-placeholder]")) {
        element.setAttribute("placeholder", t(element.dataset.i18nPlaceholder));
      }
    }

    function refreshDynamicLanguage() {
      if (state.analysis) {
        renderAll();
        renderSelectedBox();
      } else {
        elements.summaryPanel.innerHTML = emptyHtml("empty.summary");
        elements.boxDetail.innerHTML = emptyHtml("empty.boxDetailInitial");
        elements.tracksPanel.innerHTML = emptyHtml("empty.noTracks");
        elements.metricsBody.innerHTML = emptyHtml("empty.metrics");
        elements.fragmentsPanel.innerHTML = emptyHtml("empty.noFragments");
        elements.warningsPanel.innerHTML = emptyHtml("empty.noWarnings");
        elements.frameCountText.textContent = t("count.rows", { count: 0 });
        elements.graphAxisUnit.textContent = t("unit.bytes");
        elements.trackFilter.innerHTML = '<option value="">' + escapeHtml(t("option.all")) + '</option>';
        elements.metricsTrackFilter.innerHTML = '<option value="">' + escapeHtml(t("option.noTrack")) + '</option>';
      }
    }

    function emptyHtml(key, values) {
      return '<div class="empty">' + escapeHtml(t(key, values)) + '</div>';
    }

    function handleFrameRowPointerActivation(event) {
      const rowElement = event.target.closest("[data-frame-key]");
      if (!rowElement) return;
      const row = findFrameRowByKey(rowElement.dataset.frameKey);
      if (row) activateFrameRow(row);
    }

    function handleFrameRowKeyboardActivation(event) {
      if (event.key !== "Enter" && event.key !== " ") return;
      const rowElement = event.target.closest("[data-frame-key]");
      if (!rowElement) return;
      event.preventDefault();
      const row = findFrameRowByKey(rowElement.dataset.frameKey);
      if (row) activateFrameRow(row);
    }

    function findFrameRowByKey(frameKey) {
      if (!state.analysis || !frameKey) return null;
      return state.analysis.sampleRows.find((row) => getFrameRowKey(row) === frameKey) || null;
    }

    function activateFrameRow(row) {
      state.selectedFrameKey = getFrameRowKey(row);
      seekPreviewToFrameRow(row);
      scheduleFrameRender();
    }

    function seekPreviewToFrameRow(row) {
      if (!elements.filePreview || !elements.filePreview.src) return;
      const rowTimeSeconds = getRowTimeSeconds(row);
      if (!Number.isFinite(rowTimeSeconds)) return;
      const seekSeconds = Math.max(0, rowTimeSeconds);
      const applySeek = () => {
        try {
          const duration = Number(elements.filePreview.duration);
          const boundedSeekSeconds = Number.isFinite(duration) && duration > 0
            ? Math.min(seekSeconds, Math.max(0, duration - 0.001))
            : seekSeconds;
          elements.filePreview.currentTime = boundedSeekSeconds;
        } catch (error) {
          console.warn("Unable to seek preview video", error);
        }
      };
      if (elements.filePreview.readyState < 1) {
        elements.filePreview.addEventListener("loadedmetadata", applySeek, { once: true });
        elements.filePreview.load();
      } else {
        applySeek();
      }
    }

    function getFrameRowKey(row) {
      return String(row.trackId) + ":" + String(row.sampleIndex);
    }

    function hasDraggedFiles(dataTransfer) {
      if (!dataTransfer) return false;
      const types = Array.from(dataTransfer.types || []);
      if (types.includes("Files")) return true;
      return Array.from(dataTransfer.items || []).some((item) => item.kind === "file");
    }

    function getDroppedMediaFile(fileList) {
      const files = Array.from(fileList || []);
      return files.find(isLikelyMediaFile) || files[0] || null;
    }

    function isLikelyMediaFile(file) {
      if (!file) return false;
      const name = String(file.name || "").toLowerCase();
      return name.endsWith(".mp4") || name.endsWith(".m4v") || name.endsWith(".mov") ||
        file.type === "video/mp4" || file.type === "video/quicktime";
    }

    function handleWindowDragEnter(event) {
      if (!hasDraggedFiles(event.dataTransfer)) return;
      event.preventDefault();
      showDropOverlay();
    }

    function handleWindowDragOver(event) {
      if (!hasDraggedFiles(event.dataTransfer)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      showDropOverlay();
    }

    function handleWindowDragLeave(event) {
      if (!hasDraggedFiles(event.dataTransfer)) return;
      const leftWindow = event.clientX <= 0 || event.clientY <= 0 ||
        event.clientX >= window.innerWidth || event.clientY >= window.innerHeight;
      if (leftWindow) hideDropOverlay();
    }

    function handleWindowDrop(event) {
      if (!hasDraggedFiles(event.dataTransfer)) return;
      event.preventDefault();
      hideDropOverlay();
      const file = getDroppedMediaFile(event.dataTransfer.files);
      if (file) startAnalysis(file);
    }

    function showDropOverlay() {
      window.clearTimeout(state.dropHintHideTimer);
      elements.dropOverlay.classList.add("active");
      elements.dropOverlay.setAttribute("aria-hidden", "false");
      state.dropHintHideTimer = window.setTimeout(hideDropOverlay, 1400);
    }

    function hideDropOverlay() {
      window.clearTimeout(state.dropHintHideTimer);
      state.dropHintHideTimer = 0;
      elements.dropOverlay.classList.remove("active");
      elements.dropOverlay.setAttribute("aria-hidden", "true");
    }

    async function startAnalysis(file) {
      setBusy(true);
      resetView(file);
      try {
        const analysis = await Core.analyzeFile(file, { onProgress: setProgress });
        state.analysis = analysis;
        updateMediaPreviewMeta(file, analysis);
        renderAll();
        setBusy(false);
        const canScan = analysis.tracks.some((track) => getFrameTypeScanner(track));
        elements.scanButton.disabled = !canScan;
        elements.exportJsonButton.disabled = false;
        elements.exportCsvButton.disabled = false;
        if (canScan && Core.shouldAutoScan(analysis)) {
          await scanCurrentAnalysis();
        }
      } catch (error) {
        setBusy(false);
        setProgress("Failed: " + error.message, 0);
        elements.summaryPanel.innerHTML = emptyHtml("status.failed", { message: error.message });
      }
    }

    async function scanCurrentAnalysis() {
      setBusy(true);
      elements.scanButton.disabled = true;
      try {
        await Core.scanFrameTypes(state.analysis, { onProgress: setProgress });
        setProgress("Frame type scan complete", 100);
        renderFrames();
        renderWarnings();
      } catch (error) {
        setProgress("Scan stopped: " + error.message, 0);
      } finally {
        setBusy(false);
        elements.scanButton.disabled = false;
      }
    }

    function setBusy(isBusy) {
      elements.cancelButton.disabled = !isBusy;
      elements.openButton.disabled = isBusy;
    }

    function resetView(file) {
      state.analysis = null;
      state.selectedBox = null;
      state.selectedFrameKey = "";
      setFilePreview(file);
      elements.boxTree.innerHTML = "";
      elements.summaryPanel.innerHTML = emptyHtml("empty.parsingStructure");
      elements.boxDetail.innerHTML = emptyHtml("empty.selectBox");
      elements.tracksPanel.innerHTML = emptyHtml("empty.noTracks");
      elements.fragmentsPanel.innerHTML = emptyHtml("empty.noFragments");
      elements.warningsPanel.innerHTML = emptyHtml("empty.noWarnings");
      elements.metricsBody.innerHTML = emptyHtml("empty.parsingMetrics");
      elements.frameSpacer.innerHTML = "";
      elements.frameSpacer.style.height = "0px";
      elements.graphSpacer.innerHTML = "";
      elements.graphSpacer.style.height = "0px";
      elements.graphAxisScale.innerHTML = "";
      elements.graphAxisUnit.textContent = t("unit.bytes");
      elements.frameCountText.textContent = t("count.rows", { count: 0 });
      elements.trackFilter.innerHTML = '<option value="">' + escapeHtml(t("option.all")) + '</option>';
      elements.metricsTrackFilter.innerHTML = '<option value="">' + escapeHtml(t("option.noTrack")) + '</option>';
      elements.scanButton.disabled = true;
      elements.exportJsonButton.disabled = true;
      elements.exportCsvButton.disabled = true;
      setProgress("Reading " + file.name, 0);
    }

    function setFilePreview(file) {
      if (state.filePreviewUrl) URL.revokeObjectURL(state.filePreviewUrl);
      state.filePreviewUrl = URL.createObjectURL(file);
      elements.filePreview.src = state.filePreviewUrl;
      elements.filePreview.load();
      elements.mediaPreviewName.textContent = file.name || "Unnamed media";
      updateMediaPreviewMeta(file, null);
      elements.mediaPreviewBar.hidden = false;
    }

    function updateMediaPreviewMeta(file, analysis) {
      const parts = [formatBytes(file.size)];
      const durationSeconds = analysis ? getAnalysisDurationSeconds(analysis) : 0;
      if (durationSeconds > 0) {
        parts.push(formatPreviewBitrate(file.size * 8 / durationSeconds));
      }
      parts.push(file.type || t("value.unknownMime"));
      elements.mediaPreviewMeta.textContent = parts.filter(Boolean).join(" · ");
    }

    function getAnalysisDurationSeconds(analysis) {
      let maxDurationSeconds = 0;
      for (const track of analysis.tracks || []) {
        const duration = Number(track.duration);
        const timescale = Number(track.timescale);
        if (Number.isFinite(duration) && duration > 0 && timescale > 0) {
          maxDurationSeconds = Math.max(maxDurationSeconds, duration / timescale);
        }
      }
      if (maxDurationSeconds > 0) return maxDurationSeconds;
      const trackById = new Map((analysis.tracks || []).map((track) => [track.trackId, track]));
      for (const row of analysis.sampleRows || []) {
        const track = trackById.get(row.trackId);
        const timescale = Number(track && track.timescale);
        if (!timescale) continue;
        const rowEnd = (Number(row.pts || row.dts || 0) + Number(row.duration || 0)) / timescale;
        if (Number.isFinite(rowEnd)) maxDurationSeconds = Math.max(maxDurationSeconds, rowEnd);
      }
      return maxDurationSeconds;
    }

    function setProgress(label, percent) {
      const bounded = clamp(Number(percent) || 0, 0, 100);
      state.progressSourceLabel = label;
      state.progressRawLabel = translateRuntimeLabel(label);
      state.progressPercentValue = bounded;
      elements.progressText.textContent = state.progressRawLabel;
      elements.progressPercent.textContent = Math.round(bounded) + "%";
      elements.progressFill.style.width = bounded + "%";
    }

    function translateRuntimeLabel(label) {
      if (label === "Parsing boxes") return t("status.parsingBoxes");
      if (label === "Building track model") return t("status.buildingTrackModel");
      if (label === "Structure parsed") return t("status.structureParsed");
      if (label === "Scanning video samples") return t("status.scanningVideoSamples");
      if (label === "Cancelling...") return t("status.cancelling");
      if (label === "Frame type scan complete") return t("status.scanComplete");
      if (label.startsWith("Reading ")) return t("status.reading", { name: label.slice("Reading ".length) });
      if (label.startsWith("Failed: ")) return t("status.failed", { message: label.slice("Failed: ".length) });
      if (label.startsWith("Scan stopped: ")) return t("status.scanStopped", { message: label.slice("Scan stopped: ".length) });
      return label;
    }

    function setActiveTab(tabName) {
      state.activeTab = tabName;
      for (const button of document.querySelectorAll(".tab")) button.classList.toggle("active", button.dataset.tab === tabName);
      for (const panel of document.querySelectorAll(".panel")) panel.classList.remove("active");
      document.getElementById(tabName + "Panel").classList.add("active");
      if (tabName === "frames") renderFrames();
      if (tabName === "metrics") renderMetrics();
    }

    function setFrameViewMode(mode) {
      state.frameViewMode = mode;
      elements.frameGraphButton.classList.toggle("active", mode === "graph");
      elements.frameTableButton.classList.toggle("active", mode === "table");
      elements.frameGraphView.classList.toggle("active", mode === "graph");
      elements.frameTableView.classList.toggle("active", mode === "table");
      scheduleFrameRender();
    }

    function renderAll() {
      renderSummary();
      renderBoxTree();
      renderTracks();
      renderFrames();
      renderMetrics();
      renderFragments();
      renderWarnings();
    }

    function renderSummary() {
      const analysis = state.analysis;
      const videoTracks = analysis.tracks.filter((track) => track.handlerType === "vide").length;
      const fragments = analysis.topBoxes.filter((box) => box.type === "moof").length;
      const avcTracks = analysis.tracks.filter((track) => track.codec === "avc1" || track.codec === "avc3").length;
      const hevcTracks = analysis.tracks.filter((track) => track.codec === "hvc1" || track.codec === "hev1").length;
      const aacTracks = analysis.tracks.filter((track) => track.codec === "mp4a").length;
      elements.summaryPanel.innerHTML = [
        '<div class="summary-grid">',
        summaryCard(t("summary.fileSize"), formatBytes(analysis.file.size)),
        summaryCard(t("summary.tracks"), String(analysis.tracks.length)),
        summaryCard(t("summary.videoTracks"), String(videoTracks)),
        summaryCard(t("summary.fragments"), String(fragments)),
        summaryCard(t("summary.samples"), String(analysis.sampleRows.length)),
        summaryCard(t("summary.avcTracks"), String(avcTracks)),
        summaryCard(t("summary.hevcTracks"), String(hevcTracks)),
        summaryCard(t("summary.aacTracks"), String(aacTracks)),
        summaryCard(t("summary.warnings"), String(analysis.warnings.length)),
        '</div>',
        '<p class="split-note">' + escapeHtml(t("summary.note")) + '</p>',
        renderTrackTable(analysis.tracks)
      ].join("");
    }

    function summaryCard(label, value) {
      return '<div class="card"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></div>';
    }

    function renderBoxTree() {
      const analysis = state.analysis;
      elements.boxTree.innerHTML = analysis.topBoxes.map((node) => renderBoxNode(node)).join("");
    }

    function renderBoxNode(node) {
      const childHtml = node.children && node.children.length ? '<div class="tree-children">' + node.children.map(renderBoxNode).join("") + '</div>' : "";
      return '<div class="tree-node"><button class="tree-row" data-path="' + escapeHtml(node.path) + '" title="' + escapeHtml(formatBoxTypeLabel(node.type)) + '">' +
        '<span class="type">' + escapeHtml(node.type) + '</span><span class="size">' + formatBytes(Number(node.size)) + ' @ ' + escapeHtml(node.offset) + '</span></button>' + childHtml + '</div>';
    }

    elements.boxTree.addEventListener("click", (event) => {
      const row = event.target.closest(".tree-row");
      if (!row || !state.analysis) return;
      const path = row.dataset.path;
      state.selectedBox = state.analysis.allBoxes.find((box) => box.path === path) || null;
      for (const node of elements.boxTree.querySelectorAll(".tree-row")) node.classList.toggle("selected", node === row);
      renderSelectedBox();
      setActiveTab("boxes");
    });

    function renderSelectedBox() {
      if (!state.selectedBox) {
        elements.boxDetail.innerHTML = emptyHtml("empty.selectBox");
        return;
      }
      const node = state.selectedBox;
      elements.boxDetail.innerHTML = '<div class="detail-grid"><div>' +
        '<h2>' + escapeHtml(t("boxes.detailTitle")) + '</h2>' + renderKv([
          [t("box.field.type"), formatBoxTypeLabel(node.type)],
          [t("box.field.description"), getBoxTypeDescription(node.type)],
          [t("box.field.path"), node.path],
          [t("box.field.offset"), node.offset],
          [t("box.field.size"), node.size + " (" + formatBytes(Number(node.size)) + ")"],
          [t("box.field.headerSize"), node.headerSize],
          [t("box.field.children"), node.children.length],
          [t("box.field.warnings"), node.warnings.length ? node.warnings.join("; ") : t("value.none")]
        ]) + '</div><div><h2>' + escapeHtml(t("boxes.parsedFields")) + '</h2><pre class="code">' +
        escapeHtml(JSON.stringify(node.fields, safeJsonReplacer, 2)) + '</pre></div></div>';
    }

    function formatBoxTypeLabel(type) {
      const info = BOX_TYPE_INFO[type];
      const localized = getLocalizedBoxInfo(type);
      return info ? type + " (" + localized.name + ")" : type + " (" + t("boxes.unknownType") + ")";
    }

    function getBoxTypeDescription(type) {
      return getLocalizedBoxInfo(type).description;
    }

    function getLocalizedBoxInfo(type) {
      const info = BOX_TYPE_INFO[type];
      if (!info) return { name: t("boxes.unknownType"), description: t("boxes.noDescription") };
      const localized = BOX_TYPE_I18N[activeLanguage] && BOX_TYPE_I18N[activeLanguage][type];
      if (!localized) return info;
      return { name: localized[0], description: localized[1] };
    }

    function renderTracks() {
      const analysis = state.analysis;
      if (!analysis.tracks.length) {
        elements.tracksPanel.innerHTML = emptyHtml("empty.noTracks");
        return;
      }
      elements.tracksPanel.innerHTML = renderTrackTable(analysis.tracks);
      elements.trackFilter.innerHTML = '<option value="">' + escapeHtml(t("option.all")) + '</option>' + analysis.tracks.map((track) => '<option value="' + track.trackId + '">' + escapeHtml(formatTrackLabel(track)) + '</option>').join("");
      populateMetricsTrackFilter(analysis.tracks);
    }

    function renderTrackTable(tracks) {
      return '<table class="table"><thead><tr><th>' + escapeHtml(t("column.track")) + '</th><th>' + escapeHtml(t("column.handler")) + '</th><th>' + escapeHtml(t("column.codec")) + '</th><th>' + escapeHtml(t("column.duration")) + '</th><th>' + escapeHtml(t("column.media")) + '</th><th>' + escapeHtml(t("column.samples")) + '</th><th>' + escapeHtml(t("column.avgBitrate")) + '</th><th>' + escapeHtml(t("column.fpsSamples")) + '</th><th>' + escapeHtml(t("column.avgSample")) + '</th><th>' + escapeHtml(t("column.codecConfig")) + '</th></tr></thead><tbody>' +
        tracks.map((track) => {
          const summaryMetrics = getTrackSummaryMetrics(track);
          return '<tr><td>' + track.trackId + '</td><td>' + escapeHtml(track.handlerType) + '</td><td>' + escapeHtml(track.codec) + '</td><td>' +
            escapeHtml(formatTime(track.duration, track.timescale)) + '</td><td>' + escapeHtml(formatTrackMedia(track)) + '</td><td>' + track.sampleCount + '</td><td>' +
            escapeHtml(summaryMetrics ? formatBitsPerSecond(summaryMetrics.averageBitrate) : t("value.notAvailable")) + '</td><td>' +
            escapeHtml(summaryMetrics ? formatMetricNumber(summaryMetrics.sampleRate, 2) : t("value.notAvailable")) + '</td><td>' +
            escapeHtml(summaryMetrics ? formatBytes(summaryMetrics.averageSampleSize) : t("value.notAvailable")) + '</td><td>' +
            escapeHtml(formatTrackCodecConfig(track)) + '</td></tr>';
        }).join("") +
        '</tbody></table>';
    }

    function formatTrackLabel(track) {
      return t("field.track") + " " + track.trackId + " (" + track.handlerType + ")";
    }

    function formatTrackMedia(track) {
      if (track.handlerType === "vide") return track.width + "x" + track.height;
      if (track.handlerType === "soun") {
        const sampleRate = track.audioConfig && track.audioConfig.samplingFrequency ? track.audioConfig.samplingFrequency : track.sampleRate;
        const channels = track.audioConfig && track.audioConfig.channelDescription ? track.audioConfig.channelDescription : (track.channelCount ? track.channelCount + " channels" : "audio");
        return channels + (sampleRate ? " @ " + sampleRate + " Hz" : "");
      }
      return t("value.notAvailable");
    }

    function formatTrackCodecConfig(track) {
      if (track.avcConfig) return track.avcConfig.codecString + ", NAL length " + track.avcConfig.nalLengthSize;
      if (track.hevcConfig) return track.hevcConfig.codecString + ", NAL length " + track.hevcConfig.nalLengthSize + ", " + track.hevcConfig.bitDepthLuma + "-bit";
      if (track.audioConfig) {
        const codecString = track.audioConfig.codecString || "mp4a";
        return codecString + ", " + track.audioConfig.audioObjectTypeName + ", " + track.audioConfig.channelDescription;
      }
      return t("value.notAvailable");
    }

    function populateMetricsTrackFilter(tracks) {
      const currentValue = elements.metricsTrackFilter.value;
      const preferredTracks = tracks.filter((track) => track.handlerType === "vide");
      const optionTracks = preferredTracks.length ? preferredTracks : tracks;
      elements.metricsTrackFilter.innerHTML = optionTracks.length
        ? optionTracks.map((track) => '<option value="' + track.trackId + '">' + escapeHtml(formatTrackLabel(track) + " / " + track.codec) + '</option>').join("")
        : '<option value="">' + escapeHtml(t("option.noTrack")) + '</option>';
      if (currentValue && optionTracks.some((track) => String(track.trackId) === currentValue)) {
        elements.metricsTrackFilter.value = currentValue;
      } else if (optionTracks.length) {
        elements.metricsTrackFilter.value = String(optionTracks[0].trackId);
      }
    }

    function renderMetrics() {
      if (!state.analysis) return;
      const track = getSelectedMetricsTrack();
      if (!track) {
        elements.metricsBody.innerHTML = emptyHtml("empty.noTrackMetrics");
        return;
      }
      const rows = getRowsForTrack(track.trackId);
      if (!rows.length) {
        elements.metricsBody.innerHTML = emptyHtml("empty.noSamplesForTrack", { trackId: track.trackId });
        return;
      }
      const windowSize = getMetricsWindowSize();
      const pointLimit = getMetricsPointLimit();
      const metrics = buildTrackMetrics(track, rows, windowSize);
      elements.metricsBody.innerHTML = renderMetricsBody(track, metrics, pointLimit);
    }

    function getSelectedMetricsTrack() {
      if (!state.analysis) return null;
      const selectedTrackId = Number(elements.metricsTrackFilter.value);
      return state.analysis.tracks.find((track) => track.trackId === selectedTrackId) ||
        state.analysis.tracks.find((track) => track.handlerType === "vide") ||
        state.analysis.tracks[0] ||
        null;
    }

    function getRowsForTrack(trackId) {
      if (!state.analysis) return [];
      return state.analysis.sampleRows
        .filter((row) => row.trackId === trackId)
        .slice()
        .sort(compareRowsByPresentationTime);
    }

    function getMetricsWindowSize() {
      return Math.max(1, Math.min(5000, Math.floor(Number(elements.metricsWindowInput.value) || 1)));
    }

    function getMetricsPointLimit() {
      return Math.max(120, Math.min(2000, Math.floor(Number(elements.metricsPointLimitInput.value) || 900)));
    }

    function getTrackSummaryMetrics(track) {
      if (!state.analysis || !track) return null;
      const rows = getRowsForTrack(track.trackId);
      if (!rows.length) return null;
      const totalBytes = rows.reduce((sum, row) => sum + (Number(row.size) || 0), 0);
      const totalDuration = getRowsDurationSeconds(track, rows);
      if (!totalDuration) return null;
      return {
        averageBitrate: totalBytes * 8 / totalDuration,
        sampleRate: rows.length / totalDuration,
        averageSampleSize: totalBytes / rows.length
      };
    }

    function buildTrackMetrics(track, rows, windowSize) {
      const totalBytes = rows.reduce((sum, row) => sum + (Number(row.size) || 0), 0);
      const totalDuration = getRowsDurationSeconds(track, rows);
      const sizes = rows.map((row) => Number(row.size) || 0).sort((left, right) => left - right);
      const frameTypeCounts = new Map();
      for (const row of rows) {
        const frameType = row.frameType || getDefaultSampleFrameType(track) || "sample";
        frameTypeCounts.set(frameType, (frameTypeCounts.get(frameType) || 0) + 1);
      }
      const movingAveragePoints = buildMovingAveragePoints(track, rows, windowSize);
      const bitrateValues = movingAveragePoints.map((point) => point.bitrate).filter(Number.isFinite);
      const fpsValues = movingAveragePoints.map((point) => point.fps).filter(Number.isFinite);
      const syncRows = rows.filter((row) => row.isSync);
      const keyframeIntervals = [];
      for (let index = 1; index < syncRows.length; index += 1) {
        keyframeIntervals.push(Math.max(0, getRowTimeSeconds(syncRows[index]) - getRowTimeSeconds(syncRows[index - 1])));
      }
      return {
        rows,
        movingAveragePoints,
        summary: {
          durationSeconds: totalDuration,
          totalBytes,
          averageBitrate: totalDuration ? totalBytes * 8 / totalDuration : 0,
          averageFps: totalDuration ? rows.length / totalDuration : 0,
          averageSampleSize: rows.length ? totalBytes / rows.length : 0,
          minSampleSize: sizes.length ? sizes[0] : 0,
          medianSampleSize: getMedian(sizes),
          maxSampleSize: sizes.length ? sizes[sizes.length - 1] : 0,
          syncSamples: syncRows.length,
          averageKeyframeInterval: keyframeIntervals.length ? keyframeIntervals.reduce((sum, value) => sum + value, 0) / keyframeIntervals.length : 0,
          peakMovingBitrate: bitrateValues.length ? Math.max.apply(null, bitrateValues) : 0,
          peakMovingFps: fpsValues.length ? Math.max.apply(null, fpsValues) : 0
        },
        frameTypeCounts,
        topSizeRows: rows.slice().sort((left, right) => (right.size || 0) - (left.size || 0)).slice(0, 10)
      };
    }

    function buildMovingAveragePoints(track, rows, windowSize) {
      const points = [];
      const windowRows = [];
      let windowBytes = 0;
      let windowDuration = 0;
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        const durationSeconds = getSampleDurationSeconds(row, track, rows, index);
        const size = Number(row.size) || 0;
        windowRows.push({ row, size, durationSeconds });
        windowBytes += size;
        windowDuration += durationSeconds;
        while (windowRows.length > windowSize) {
          const removed = windowRows.shift();
          windowBytes -= removed.size;
          windowDuration -= removed.durationSeconds;
        }
        const pointCount = windowRows.length;
        points.push({
          time: getRowTimeSeconds(row),
          bitrate: windowDuration > 0 ? windowBytes * 8 / windowDuration : 0,
          fps: windowDuration > 0 ? pointCount / windowDuration : 0,
          row
        });
      }
      return points;
    }

    function getSampleDurationSeconds(row, track, rows, index) {
      const timescale = Number(track && track.timescale);
      const duration = Number(row.duration);
      if (timescale > 0 && duration > 0) return duration / timescale;
      if (rows && index < rows.length - 1) {
        const diff = getRowTimeSeconds(rows[index + 1]) - getRowTimeSeconds(row);
        if (diff > 0) return diff;
      }
      return 0;
    }

    function getRowsDurationSeconds(track, rows) {
      const durationSum = rows.reduce((sum, row, index) => sum + getSampleDurationSeconds(row, track, rows, index), 0);
      if (durationSum > 0) return durationSum;
      const trackDuration = Number(track && track.duration);
      const timescale = Number(track && track.timescale);
      return trackDuration > 0 && timescale > 0 ? trackDuration / timescale : 0;
    }

    function getMedian(sortedValues) {
      if (!sortedValues.length) return 0;
      const middle = Math.floor(sortedValues.length / 2);
      return sortedValues.length % 2 ? sortedValues[middle] : (sortedValues[middle - 1] + sortedValues[middle]) / 2;
    }

    function renderMetricsBody(track, metrics, pointLimit) {
      const summary = metrics.summary;
      return [
        '<div class="metrics-summary-grid">',
        summaryCard(t("metrics.track"), formatTrackLabel(track) + " / " + track.codec),
        summaryCard(t("column.duration"), formatMetricNumber(summary.durationSeconds, 3) + "s"),
        summaryCard(t("column.avgBitrate"), formatBitsPerSecond(summary.averageBitrate)),
        summaryCard(track.handlerType === "vide" ? t("metrics.avgFps") : t("metrics.samplesPerSecond"), formatMetricNumber(summary.averageFps, 3)),
        summaryCard(t("metrics.peakMaBitrate"), formatBitsPerSecond(summary.peakMovingBitrate)),
        summaryCard(t("metrics.peakMaFps"), formatMetricNumber(summary.peakMovingFps, 3)),
        summaryCard(t("metrics.medianSample"), formatBytes(summary.medianSampleSize)),
        summaryCard(t("metrics.syncSamples"), String(summary.syncSamples)),
        '</div>',
        '<div class="metrics-chart-grid">',
        renderMetricChart(t("metrics.bitrateMovingAverage"), metrics.movingAveragePoints, "bitrate", pointLimit, formatBitsPerSecond, "bitrate"),
        renderMetricChart(track.handlerType === "vide" ? t("metrics.fpsMovingAverage") : t("metrics.sampleRateMovingAverage"), metrics.movingAveragePoints, "fps", pointLimit, (value) => formatMetricNumber(value, 3), "fps"),
        '</div>',
        '<div class="metrics-insights">',
        renderFrameTypeDistribution(metrics.frameTypeCounts, metrics.rows.length),
        renderTopSampleRows(metrics.topSizeRows),
        '</div>'
      ].join("");
    }

    function renderMetricChart(title, points, valueKey, pointLimit, formatter, className) {
      if (!points.length) return '<div class="metric-chart-card">' + emptyHtml("empty.noChartPoints") + '</div>';
      const chartPoints = downsamplePoints(points, pointLimit);
      const values = chartPoints.map((point) => Number(point[valueKey]) || 0);
      const maxValue = Math.max(1, Math.max.apply(null, values));
      const minTime = chartPoints[0].time;
      const maxTime = chartPoints[chartPoints.length - 1].time;
      const timeSpan = Math.max(0.000001, maxTime - minTime);
      const innerWidth = METRIC_CHART_WIDTH - METRIC_CHART_PADDING.left - METRIC_CHART_PADDING.right;
      const innerHeight = METRIC_CHART_HEIGHT - METRIC_CHART_PADDING.top - METRIC_CHART_PADDING.bottom;
      const polylinePoints = chartPoints.map((point) => {
        const x = METRIC_CHART_PADDING.left + ((point.time - minTime) / timeSpan) * innerWidth;
        const y = METRIC_CHART_PADDING.top + innerHeight - ((Number(point[valueKey]) || 0) / maxValue) * innerHeight;
        return x.toFixed(2) + "," + y.toFixed(2);
      }).join(" ");
      const gridLines = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
        const y = METRIC_CHART_PADDING.top + innerHeight - ratio * innerHeight;
        const label = formatter(maxValue * ratio);
        return '<line class="metric-grid-line" x1="' + METRIC_CHART_PADDING.left + '" x2="' + (METRIC_CHART_WIDTH - METRIC_CHART_PADDING.right) + '" y1="' + y.toFixed(2) + '" y2="' + y.toFixed(2) + '"></line>' +
          '<text class="metric-axis-label" x="8" y="' + (y + 4).toFixed(2) + '">' + escapeHtml(label) + '</text>';
      }).join("");
      return '<section class="metric-chart-card"><div class="metric-chart-head"><strong>' + escapeHtml(title) + '</strong><span>' + escapeHtml(t("metrics.chartMax", { value: formatter(maxValue), count: chartPoints.length })) + '</span></div>' +
        '<svg class="metric-chart" viewBox="0 0 ' + METRIC_CHART_WIDTH + ' ' + METRIC_CHART_HEIGHT + '" preserveAspectRatio="none" aria-label="' + escapeHtml(title) + '">' +
        gridLines +
        '<text class="metric-axis-label" x="' + METRIC_CHART_PADDING.left + '" y="' + (METRIC_CHART_HEIGHT - 8) + '">' + escapeHtml(formatMetricNumber(minTime, 2)) + 's</text>' +
        '<text class="metric-axis-label" text-anchor="end" x="' + (METRIC_CHART_WIDTH - METRIC_CHART_PADDING.right) + '" y="' + (METRIC_CHART_HEIGHT - 8) + '">' + escapeHtml(formatMetricNumber(maxTime, 2)) + 's</text>' +
        '<polyline class="metric-line ' + escapeHtml(className) + '" points="' + polylinePoints + '"></polyline>' +
        '</svg></section>';
    }

    function downsamplePoints(points, limit) {
      if (points.length <= limit) return points;
      const result = [];
      const step = points.length / limit;
      for (let index = 0; index < limit; index += 1) {
        result.push(points[Math.min(points.length - 1, Math.floor(index * step))]);
      }
      return result;
    }

    function renderFrameTypeDistribution(frameTypeCounts, totalRows) {
      const entries = Array.from(frameTypeCounts.entries()).sort((left, right) => right[1] - left[1]);
      if (!entries.length) return '<section class="metric-section"><h3>' + escapeHtml(t("metrics.frameTypeDistribution")) + '</h3>' + emptyHtml("empty.noFrameTypeData") + '</section>';
      return '<section class="metric-section"><h3>' + escapeHtml(t("metrics.frameTypeDistribution")) + '</h3><div class="metric-type-list">' +
        entries.map(([frameType, count]) => {
          const ratio = totalRows ? count * 100 / totalRows : 0;
          return '<div class="metric-type-row"><span>' + escapeHtml(frameType) + '</span><div class="metric-type-bar"><span style="width:' + clamp(ratio, 0, 100).toFixed(2) + '%"></span></div><strong>' + count + '</strong></div>';
        }).join("") +
        '</div></section>';
    }

    function renderTopSampleRows(rows) {
      if (!rows.length) return '<section class="metric-section"><h3>' + escapeHtml(t("metrics.largestSamples")) + '</h3>' + emptyHtml("empty.noSamples") + '</section>';
      return '<section class="metric-section"><h3>' + escapeHtml(t("metrics.largestSamples")) + '</h3><table class="table"><thead><tr><th>' + escapeHtml(t("value.sample")) + '</th><th>' + escapeHtml(t("column.time")) + '</th><th>' + escapeHtml(t("column.size")) + '</th><th>' + escapeHtml(t("column.type")) + '</th></tr></thead><tbody>' +
        rows.map((row) => {
          const frameRowKey = getFrameRowKey(row);
          return '<tr class="metric-click-row" role="button" tabindex="0" data-frame-key="' + escapeHtml(frameRowKey) + '"><td>#' + row.sampleIndex + '</td><td>' +
            escapeHtml(formatGraphTime(row)) + '</td><td>' + escapeHtml(formatBytes(row.size || 0)) + '</td><td>' + escapeHtml(formatFrameTypeLabel(row.frameType || "sample")) + '</td></tr>';
        }).join("") +
        '</tbody></table></section>';
    }

    function renderFrames() {
      if (!state.analysis) return;
      const rows = applyFrameFilters(state.analysis.sampleRows);
      state.filteredRows = rows;
      state.graphRows = rows.slice().sort(compareRowsByPresentationTime);
      state.graphMaxSize = Math.max(1, ...state.graphRows.map((row) => row.size || 0));
      elements.frameCountText.textContent = t("count.rows", { count: rows.length });
      elements.frameSpacer.style.height = Math.max(1, rows.length * ROW_HEIGHT) + "px";
      elements.graphSpacer.style.height = Math.max(1, state.graphRows.length * GRAPH_ROW_HEIGHT) + "px";
      renderGraphAxis();
      scheduleFrameRender();
    }

    function compareRowsByPresentationTime(left, right) {
      const leftTime = getRowTimeSeconds(left);
      const rightTime = getRowTimeSeconds(right);
      if (leftTime !== rightTime) return leftTime - rightTime;
      if (left.trackId !== right.trackId) return left.trackId - right.trackId;
      return left.sampleIndex - right.sampleIndex;
    }

    function getRowTrack(row) {
      if (!state.analysis) return null;
      return state.analysis.tracks.find((track) => track.trackId === row.trackId) || null;
    }

    function getRowTimeSeconds(row) {
      const track = getRowTrack(row);
      if (!track || !track.timescale) return Number(row.pts || row.dts || row.sampleIndex || 0);
      return Number(row.pts || row.dts || 0) / Number(track.timescale);
    }

    function renderGraphAxis() {
      const maxSize = state.graphMaxSize || 1;
      const ticks = [0, 0.25, 0.5, 0.75, 1];
      elements.graphAxisScale.innerHTML = ticks.map((ratio) => {
        const value = Math.round(maxSize * ratio);
        return '<span class="axis-tick" style="left:' + (ratio * 100) + '%">' + escapeHtml(formatBytes(value)) + '</span>';
      }).join("");
      elements.graphAxisUnit.textContent = t("unit.max", { value: formatBytes(maxSize) });
    }

    function applyFrameFilters(rows) {
      const trackValue = elements.trackFilter.value;
      const typeValue = elements.typeFilter.value;
      const syncValue = elements.syncFilter.value;
      const minSize = elements.minSizeFilter.value === "" ? null : Number(elements.minSizeFilter.value);
      const maxSize = elements.maxSizeFilter.value === "" ? null : Number(elements.maxSizeFilter.value);
      const warningOnly = elements.warningOnlyFilter.checked;
      return rows.filter((row) => {
        if (trackValue && String(row.trackId) !== trackValue) return false;
        if (typeValue) {
          if (typeValue === "mixed") {
            if (!String(row.frameType).startsWith("mixed")) return false;
          } else if ((row.frameType || "unknown") !== typeValue) return false;
        }
        if (syncValue === "yes" && !row.isSync) return false;
        if (syncValue === "no" && row.isSync) return false;
        if (minSize !== null && row.size < minSize) return false;
        if (maxSize !== null && row.size > maxSize) return false;
        if (warningOnly && (!row.warnings || !row.warnings.length)) return false;
        return true;
      });
    }

    function scheduleFrameRender() {
      cancelAnimationFrame(state.renderFrameRequest);
      state.renderFrameRequest = requestAnimationFrame(() => {
        if (state.frameViewMode === "graph") renderVisibleGraphRows();
        else renderVisibleFrameRows();
      });
    }

    function renderVisibleFrameRows() {
      const rows = state.filteredRows;
      const scrollTop = elements.frameScroller.scrollTop;
      const height = elements.frameScroller.clientHeight || 400;
      const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 8);
      const last = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + 8);
      const html = [];
      for (let index = first; index < last; index += 1) {
        html.push(renderFrameRow(rows[index], index));
      }
      elements.frameSpacer.innerHTML = html.join("");
    }

    function renderVisibleGraphRows() {
      const rows = state.graphRows;
      const scrollTop = elements.graphScroller.scrollTop;
      const height = elements.graphScroller.clientHeight || 400;
      const first = Math.max(0, Math.floor(scrollTop / GRAPH_ROW_HEIGHT) - 10);
      const last = Math.min(rows.length, Math.ceil((scrollTop + height) / GRAPH_ROW_HEIGHT) + 10);
      const html = [];
      for (let index = first; index < last; index += 1) {
        html.push(renderGraphRow(rows[index], index));
      }
      elements.graphSpacer.innerHTML = html.join("");
    }

    function renderFrameRow(row, visualIndex) {
      const type = row.frameType || "unknown";
      const typeClass = getFrameTypeClass(type);
      const chunkOrFragment = row.fragmentIndex ? "frag " + row.fragmentIndex : row.chunkIndex ? "chunk " + row.chunkIndex : "";
      const frameRowKey = getFrameRowKey(row);
      const selectedClass = frameRowKey === state.selectedFrameKey ? " selected" : "";
      const ariaLabel = t("aria.seekFrame", { trackId: row.trackId, sampleIndex: row.sampleIndex, time: formatGraphTime(row) });
      return '<div class="frame-row' + selectedClass + '" role="button" tabindex="0" data-frame-key="' + escapeHtml(frameRowKey) + '" aria-label="' + escapeHtml(ariaLabel) + '" style="top:' + (visualIndex * ROW_HEIGHT) + 'px">' +
        '<div>' + row.sampleIndex + '</div><div>' + row.trackId + '</div><div title="' + escapeHtml(row.offset) + '">' + escapeHtml(row.offset) + '</div><div>' + row.size + '</div><div>' + row.dts + '</div><div>' + row.pts + '</div><div>' + row.duration + '</div><div>' + (row.isSync ? t("value.yes") : t("value.no")) + '</div><div><span class="pill ' + typeClass + '">' + escapeHtml(formatFrameTypeLabel(type)) + '</span></div><div title="' + escapeHtml(row.nalTypes.join(", ")) + '">' + escapeHtml(row.nalTypes.join(",")) + '</div><div>' + escapeHtml(chunkOrFragment) + '</div></div>';
    }

    function renderGraphRow(row, visualIndex) {
      const type = row.frameType || "unknown";
      const typeClass = getFrameTypeClass(type);
      const widthPercent = state.graphMaxSize ? clamp((row.size || 0) * 100 / state.graphMaxSize, 0, 100) : 0;
      const timeLabel = formatGraphTime(row);
      const frameRowKey = getFrameRowKey(row);
      const selectedClass = frameRowKey === state.selectedFrameKey ? " selected" : "";
      const ariaLabel = t("aria.seekFrame", { trackId: row.trackId, sampleIndex: row.sampleIndex, time: timeLabel });
      const title = [
        "track " + row.trackId + " sample " + row.sampleIndex,
        "PTS " + row.pts,
        "DTS " + row.dts,
        "size " + row.size + " bytes",
        "type " + type,
        "offset " + row.offset
      ].join(" | ");
      return '<div class="graph-row' + selectedClass + '" role="button" tabindex="0" data-frame-key="' + escapeHtml(frameRowKey) + '" aria-label="' + escapeHtml(ariaLabel) + '" style="top:' + (visualIndex * GRAPH_ROW_HEIGHT) + 'px" title="' + escapeHtml(title) + '">' +
        '<div class="graph-time"><span>' + escapeHtml(timeLabel) + '</span><strong>#' + row.sampleIndex + ' T' + row.trackId + '</strong></div>' +
        '<div class="graph-plot"><span class="graph-bar ' + typeClass + '" style="width:' + widthPercent.toFixed(4) + '%"></span></div>' +
        '<div class="graph-size">' + escapeHtml(formatBytes(row.size || 0)) + '</div>' +
        '</div>';
    }

    function getFrameTypeClass(type) {
      if (type === "I" || type === "IDR") return "i";
      if (type === "P") return "p";
      if (type === "B") return "b";
      if (type === "AAC" || type === "audio") return "aac";
      if (type === "unknown") return "warn";
      if (String(type).startsWith("mixed")) return "err";
      return "";
    }

    function formatFrameTypeLabel(type) {
      if (type === "unknown") return t("value.unknown");
      if (type === "audio") return t("value.audio");
      if (type === "sample") return t("value.sample");
      if (String(type).startsWith("mixed") && activeLanguage === "ko") return type.replace("mixed", "혼합");
      return type;
    }

    function formatGraphTime(row) {
      const track = getRowTrack(row);
      if (!track || !track.timescale) return String(row.pts || row.dts || row.sampleIndex);
      return formatTime(row.pts, track.timescale);
    }

    function renderFragments() {
      const analysis = state.analysis;
      const moofs = analysis.topBoxes.filter((box) => box.type === "moof");
      if (!moofs.length) {
        elements.fragmentsPanel.innerHTML = emptyHtml("empty.noMoof");
        return;
      }
      elements.fragmentsPanel.innerHTML = '<table class="table"><thead><tr><th>#</th><th>' + escapeHtml(t("column.offset")) + '</th><th>' + escapeHtml(t("column.size")) + '</th><th>traf</th><th>trun</th><th>' + escapeHtml(t("column.samples")) + '</th></tr></thead><tbody>' +
        moofs.map((moof, index) => {
          const trafs = (moof.children || []).filter((child) => child.type === "traf");
          const truns = findDescendants(moof, "trun", []);
          const samples = truns.reduce((sum, trun) => sum + (trun.fields.sampleCount || 0), 0);
          return '<tr><td>' + (index + 1) + '</td><td>' + escapeHtml(moof.offset) + '</td><td>' + escapeHtml(moof.size) + '</td><td>' + trafs.length + '</td><td>' + truns.length + '</td><td>' + samples + '</td></tr>';
        }).join("") + '</tbody></table>';
    }

    function renderWarnings() {
      const warnings = [];
      if (state.analysis) {
        warnings.push.apply(warnings, state.analysis.warnings.map(localizeWarning));
        for (const box of state.analysis.allBoxes) {
          for (const warning of box.warnings || []) warnings.push(box.path + ": " + localizeWarning(warning));
        }
        for (const row of state.analysis.sampleRows) {
          for (const warning of row.warnings || []) warnings.push(t("warning.prefixTrackSample", { trackId: row.trackId, sampleIndex: row.sampleIndex, warning: localizeWarning(warning) }));
        }
      }
      if (!warnings.length) {
        elements.warningsPanel.innerHTML = emptyHtml("empty.noWarnings");
        return;
      }
      elements.warningsPanel.innerHTML = '<div class="warning-list">' + warnings.map((warning) => '<div class="warning-item">' + escapeHtml(warning) + '</div>').join("") + '</div>';
    }

    function renderKv(values) {
      const entries = Array.isArray(values) ? values : Object.entries(values);
      return '<div class="kv">' + entries.map(([key, value]) => '<div>' + escapeHtml(key) + '</div><div>' + escapeHtml(String(value)) + '</div>').join("") + '</div>';
    }

    function localizeWarning(warning) {
      if (activeLanguage !== "ko") return warning;
      return String(warning)
        .replace("Sample offset missing.", "샘플 오프셋이 없습니다.")
        .replace("Fragment sample size is missing.", "프래그먼트 샘플 크기가 없습니다.")
        .replace("Payload too large to parse inline:", "payload가 너무 커서 inline 파싱하지 않았습니다:")
        .replace("Could not parse fields:", "필드를 파싱하지 못했습니다:")
        .replace("No moov box found. Fragment-only streams without init segment are not supported.", "moov 박스가 없습니다. init segment 없는 fragment-only stream은 지원하지 않습니다.")
        .replace("AVC sample entry has no avcC box.", "AVC sample entry에 avcC 박스가 없습니다.")
        .replace("HEVC sample entry has no hvcC box.", "HEVC sample entry에 hvcC 박스가 없습니다.")
        .replace("AAC sample entry has no esds AudioSpecificConfig.", "AAC sample entry에 esds AudioSpecificConfig가 없습니다.")
        .replace("scan failed:", "스캔 실패:");
    }

    function exportJson() {
      if (!state.analysis) return;
      const payload = {
        file: state.analysis.file,
        boxes: state.analysis.topBoxes,
        tracks: state.analysis.tracks.map((track) => ({
          trackId: track.trackId,
          handlerType: track.handlerType,
          codec: track.codec,
          timescale: track.timescale,
          duration: track.duration,
          width: track.width,
          height: track.height,
          channelCount: track.channelCount,
          sampleRate: track.sampleRate,
          sampleCount: track.sampleCount,
          avcConfig: track.avcConfig,
          hevcConfig: track.hevcConfig,
          audioConfig: track.audioConfig
        })),
        sampleRows: state.analysis.sampleRows,
        warnings: state.analysis.warnings
      };
      downloadText("mp4-analysis.json", JSON.stringify(payload, safeJsonReplacer, 2), "application/json");
    }

    function exportCsv() {
      if (!state.analysis) return;
      const header = ["trackId", "sampleIndex", "offset", "size", "dts", "pts", "duration", "isSync", "frameType", "nalTypes", "chunkIndex", "fragmentIndex", "warnings"];
      const lines = [header.join(",")];
      for (const row of state.analysis.sampleRows) {
        lines.push(header.map((key) => csvCell(Array.isArray(row[key]) ? row[key].join("|") : row[key])).join(","));
      }
      downloadText("mp4-samples.csv", lines.join("\n"), "text/csv");
    }

    function csvCell(value) {
      const text = value === undefined || value === null ? "" : String(value);
      if (/[",\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
      return text;
    }

    function downloadText(filename, text, type) {
      const blob = new Blob([text], { type });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      })[char]);
    }
  })();

(() => {
  const payload = {
  "albums": [
    {
      "displayTitle": "Common",
      "photoCount": 14,
      "slug": "common",
      "sortIndex": 1,
      "title": "Common"
    },
    {
      "displayTitle": "Showcase",
      "photoCount": 8,
      "slug": "showcase",
      "sortIndex": 2,
      "title": "Showcase"
    }
  ],
  "cloudPdfWorkflow": {
    "assembly": "Cloud service receives selected media ids grouped by apartment project plus edited titles, then generates one PDF or slideshow per project on demand. Slideshows choose one single-guitar cue at random, keep generated music at 0 dB, mix source video audio 20 dB lower, and carry music credit metadata for an end-card only when a track requires it; videos keep source duration in slideshow output and use the 10% still frame in PDFs.",
    "batchManifest": {
      "batchIdFormat": "YYYYMMDDTHHMMSSZ",
      "itemFields": [
        "photoId",
        "title",
        "sortIndex",
        "mediaType",
        "durationSeconds",
        "pdfTreatment",
        "pdfStillPercent",
        "slideshowDurationPolicy",
        "slideshowDurationSeconds",
        "sourceVideoPrivateKey",
        "sourceDurationSeconds",
        "projectId",
        "projectTitle",
        "projectIds",
        "transition",
        "effect",
        "outputTreatment"
      ],
      "projectFields": [
        "projectId",
        "projectTitle",
        "sortIndex",
        "items"
      ],
      "resumeBehavior": "Loading a prior batch manifest seeds the selected media IDs and edited titles by project; generating PDFs or slideshow plans from that draft writes a new timestamped batch manifest with sourceBatchId set to the prior batchId.",
      "retrievalOrder": "createdAt desc",
      "schema": "photosbyelie.realEstatePdfBatch.v1",
      "storageKeyPattern": "real-estate/pdf-batches/Corine-gallery/{batchId}.json",
      "template": {
        "batchId": "",
        "createdAt": "",
        "customer": "Corine",
        "galleryKey": "Corine-gallery",
        "items": [
          {
            "durationSeconds": null,
            "mediaType": "photo",
            "pdfStillPercent": null,
            "pdfTreatment": "photo",
            "photoId": "",
            "projectId": "",
            "projectIds": [],
            "projectTitle": "",
            "slideshowDurationPolicy": "fixed-photo-duration",
            "slideshowDurationSeconds": 4,
            "sortIndex": 1,
            "sourceDurationSeconds": null,
            "sourceVideoPrivateKey": "",
            "title": ""
          }
        ],
        "pdfMode": "one-pdf-per-project",
        "projects": [
          {
            "items": [
              {
                "durationSeconds": null,
                "mediaType": "photo",
                "pdfStillPercent": null,
                "pdfTreatment": "photo",
                "photoId": "",
                "projectId": "",
                "projectTitle": "",
                "slideshowDurationPolicy": "fixed-photo-duration",
                "slideshowDurationSeconds": 4,
                "sortIndex": 1,
                "sourceDurationSeconds": null,
                "sourceVideoPrivateKey": "",
                "title": ""
              }
            ],
            "projectId": "",
            "projectTitle": "",
            "sortIndex": 1
          }
        ],
        "schema": "photosbyelie.realEstatePdfBatch.v1",
        "sourceBatchId": "",
        "sourceImportGeneratedAt": "2026-07-18T09:25:01+00:00"
      }
    },
    "cloudImageKeyField": "cloudPdfSource.publicKey",
    "imageField": "cloudPdfSource.imageUrl",
    "largeFileMitigation": "Importer prepares cloud PDF/slideshow source metadata instead of final outputs; final assembly/download belongs to the cloud path so the browser does not build one huge Blob locally.",
    "mode": "one-output-per-project",
    "projectStoreKey": "photosbyelie-real-estate-projects-Corine-gallery",
    "selectionStoreKey": "photosbyelie-real-estate-liked-Corine-gallery",
    "slideshowMusic": {
      "creditPolicy": {
        "durationSeconds": 4,
        "note": "CC0/public-domain tracks do not require attribution, but per-track source and license metadata can be carried into video manifests when needed.",
        "renderPolicy": "append-end-card-when-required",
        "requiredField": "creditRequired",
        "textField": "creditText"
      },
      "musicGainDb": 0,
      "schema": "photosbyelie.realEstateSlideshowMusic.v1",
      "selection": "random-from-single-guitar-pool",
      "sourceVideoAudioGainDb": -20,
      "sourceVideoAudioLinearGain": 0.1,
      "tracks": [
        {
          "bpm": 82,
          "duration": 113.02,
          "src": "./assets/music/slideshow-guitar/quiet-linden-study-single-guitar-113s.mp3",
          "title": "Quiet Linden Study"
        },
        {
          "bpm": 86,
          "duration": 107.847,
          "src": "./assets/music/slideshow-guitar/warm-balcony-theme-single-guitar-107s.mp3",
          "title": "Warm Balcony Theme"
        },
        {
          "bpm": 88,
          "duration": 105.436,
          "src": "./assets/music/slideshow-guitar/open-house-aria-single-guitar-104s.mp3",
          "title": "Open House Aria"
        },
        {
          "bpm": 80,
          "duration": 115.8,
          "src": "./assets/music/slideshow-guitar/cedar-stairwell-single-guitar-116s.mp3",
          "title": "Cedar Stairwell"
        },
        {
          "bpm": 84,
          "duration": 110.371,
          "src": "./assets/music/slideshow-guitar/terrace-in-c-single-guitar-109s.mp3",
          "title": "Terrace in C"
        },
        {
          "bpm": 90,
          "duration": 103.133,
          "src": "./assets/music/slideshow-guitar/window-light-etude-single-guitar-103s.mp3",
          "title": "Window Light Etude"
        },
        {
          "bpm": 82,
          "duration": 113.02,
          "src": "./assets/music/slideshow-guitar/blue-hour-listing-single-guitar-112s.mp3",
          "title": "Blue Hour Listing"
        },
        {
          "bpm": 86,
          "duration": 107.847,
          "src": "./assets/music/slideshow-guitar/ivory-courtyard-single-guitar-106s.mp3",
          "title": "Ivory Courtyard"
        },
        {
          "bpm": 84,
          "duration": 110.371,
          "src": "./assets/music/slideshow-guitar/sunday-parlor-single-guitar-108s.mp3",
          "title": "Sunday Parlor"
        },
        {
          "bpm": 90,
          "duration": 103.133,
          "src": "./assets/music/slideshow-guitar/soft-key-return-single-guitar-101s.mp3",
          "title": "Soft Key Return"
        }
      ],
      "transition": "subtle-centered-ken-burns"
    },
    "titleField": "editableTitle",
    "titleStoreKey": "photosbyelie-real-estate-titles-Corine-gallery"
  },
  "customer": {
    "email": "corine.bn2007@yahoo.fr",
    "name": "Corine",
    "username": "Corine"
  },
  "deliverables": [],
  "gallery": {
    "accent": "spain",
    "deliverables": [],
    "description": "Private real-estate selection gallery for project PDF and slideshow assembly.",
    "key": "Corine-gallery",
    "photos": [
      {
        "album": "Common",
        "albumSlug": "common",
        "albumTitle": "Common",
        "caption": "Common",
        "captionColor": "939C7F",
        "className": "real-estate-photo",
        "cloudPdfSource": {
          "bytes": 404449,
          "dimensions": {
            "height": 1200,
            "width": 1800
          },
          "imageUrl": "previews/common/corine-common-0002-d5h-3429_1800.jpg",
          "maxEdge": 1800,
          "mediaType": "photo",
          "publicKey": "RE/Corine/previews/common/corine-common-0002-d5h-3429_1800.jpg",
          "title": "01"
        },
        "displayVariant": "original",
        "editableTitle": "01",
        "full": "0002-D5H_3429.jpg",
        "gallerySrc": "previews/common/corine-common-0002-d5h-3429_900.jpg",
        "id": "corine-common-0002-d5h-3429",
        "imageSrc": "previews/common/corine-common-0002-d5h-3429_1800.jpg",
        "media": {
          "publicPreview": {
            "allowed": true,
            "detailDimensions": {
              "height": 1200,
              "width": 1800
            },
            "detailKey": "RE/Corine/previews/common/corine-common-0002-d5h-3429_1800.jpg",
            "detailUrl": "previews/common/corine-common-0002-d5h-3429_1800.jpg",
            "dimensions": {
              "height": 600,
              "width": 900
            },
            "galleryKey": "RE/Corine/previews/common/corine-common-0002-d5h-3429_900.jpg",
            "galleryUrl": "previews/common/corine-common-0002-d5h-3429_900.jpg",
            "previewUrl": "previews/common/corine-common-0002-d5h-3429_1800.jpg",
            "thumbnailUrl": "previews/common/corine-common-0002-d5h-3429_900.jpg"
          },
          "type": "photo"
        },
        "metadata": [
          {
            "label": "Client",
            "value": "Corine"
          },
          {
            "label": "Album",
            "value": "Common"
          },
          {
            "label": "Original file",
            "value": "0002-D5H_3429.jpg"
          },
          {
            "label": "Original size",
            "value": "4176 x 2784"
          },
          {
            "label": "Preview 900",
            "value": "900 x 600"
          },
          {
            "label": "Preview 1800",
            "value": "1800 x 1200"
          }
        ],
        "sortIndex": 1,
        "title": "01"
      },
      {
        "album": "Common",
        "albumSlug": "common",
        "albumTitle": "Common",
        "caption": "Common",
        "captionColor": "A0937E",
        "className": "real-estate-photo",
        "cloudPdfSource": {
          "bytes": 480600,
          "dimensions": {
            "height": 1200,
            "width": 1800
          },
          "imageUrl": "previews/common/corine-common-0004-d5h-3431_1800.jpg",
          "maxEdge": 1800,
          "mediaType": "photo",
          "publicKey": "RE/Corine/previews/common/corine-common-0004-d5h-3431_1800.jpg",
          "title": "02"
        },
        "displayVariant": "original",
        "editableTitle": "02",
        "full": "0004-D5H_3431.jpg",
        "gallerySrc": "previews/common/corine-common-0004-d5h-3431_900.jpg",
        "id": "corine-common-0004-d5h-3431",
        "imageSrc": "previews/common/corine-common-0004-d5h-3431_1800.jpg",
        "media": {
          "publicPreview": {
            "allowed": true,
            "detailDimensions": {
              "height": 1200,
              "width": 1800
            },
            "detailKey": "RE/Corine/previews/common/corine-common-0004-d5h-3431_1800.jpg",
            "detailUrl": "previews/common/corine-common-0004-d5h-3431_1800.jpg",
            "dimensions": {
              "height": 600,
              "width": 900
            },
            "galleryKey": "RE/Corine/previews/common/corine-common-0004-d5h-3431_900.jpg",
            "galleryUrl": "previews/common/corine-common-0004-d5h-3431_900.jpg",
            "previewUrl": "previews/common/corine-common-0004-d5h-3431_1800.jpg",
            "thumbnailUrl": "previews/common/corine-common-0004-d5h-3431_900.jpg"
          },
          "type": "photo"
        },
        "metadata": [
          {
            "label": "Client",
            "value": "Corine"
          },
          {
            "label": "Album",
            "value": "Common"
          },
          {
            "label": "Original file",
            "value": "0004-D5H_3431.jpg"
          },
          {
            "label": "Original size",
            "value": "4176 x 2784"
          },
          {
            "label": "Preview 900",
            "value": "900 x 600"
          },
          {
            "label": "Preview 1800",
            "value": "1800 x 1200"
          }
        ],
        "sortIndex": 2,
        "title": "02"
      },
      {
        "album": "Common",
        "albumSlug": "common",
        "albumTitle": "Common",
        "caption": "Common",
        "captionColor": "727C5C",
        "className": "real-estate-photo",
        "cloudPdfSource": {
          "bytes": 532506,
          "dimensions": {
            "height": 1200,
            "width": 1800
          },
          "imageUrl": "previews/common/corine-common-0006-d5h-3433_1800.jpg",
          "maxEdge": 1800,
          "mediaType": "photo",
          "publicKey": "RE/Corine/previews/common/corine-common-0006-d5h-3433_1800.jpg",
          "title": "03"
        },
        "displayVariant": "original",
        "editableTitle": "03",
        "full": "0006-D5H_3433.jpg",
        "gallerySrc": "previews/common/corine-common-0006-d5h-3433_900.jpg",
        "id": "corine-common-0006-d5h-3433",
        "imageSrc": "previews/common/corine-common-0006-d5h-3433_1800.jpg",
        "media": {
          "publicPreview": {
            "allowed": true,
            "detailDimensions": {
              "height": 1200,
              "width": 1800
            },
            "detailKey": "RE/Corine/previews/common/corine-common-0006-d5h-3433_1800.jpg",
            "detailUrl": "previews/common/corine-common-0006-d5h-3433_1800.jpg",
            "dimensions": {
              "height": 600,
              "width": 900
            },
            "galleryKey": "RE/Corine/previews/common/corine-common-0006-d5h-3433_900.jpg",
            "galleryUrl": "previews/common/corine-common-0006-d5h-3433_900.jpg",
            "previewUrl": "previews/common/corine-common-0006-d5h-3433_1800.jpg",
            "thumbnailUrl": "previews/common/corine-common-0006-d5h-3433_900.jpg"
          },
          "type": "photo"
        },
        "metadata": [
          {
            "label": "Client",
            "value": "Corine"
          },
          {
            "label": "Album",
            "value": "Common"
          },
          {
            "label": "Original file",
            "value": "0006-D5H_3433.jpg"
          },
          {
            "label": "Original size",
            "value": "4176 x 2784"
          },
          {
            "label": "Preview 900",
            "value": "900 x 600"
          },
          {
            "label": "Preview 1800",
            "value": "1800 x 1200"
          }
        ],
        "sortIndex": 3,
        "title": "03"
      },
      {
        "album": "Common",
        "albumSlug": "common",
        "albumTitle": "Common",
        "caption": "Common",
        "captionColor": "6D7861",
        "className": "real-estate-photo",
        "cloudPdfSource": {
          "bytes": 523609,
          "dimensions": {
            "height": 1200,
            "width": 1800
          },
          "imageUrl": "previews/common/corine-common-0008-d5h-3435_1800.jpg",
          "maxEdge": 1800,
          "mediaType": "photo",
          "publicKey": "RE/Corine/previews/common/corine-common-0008-d5h-3435_1800.jpg",
          "title": "04"
        },
        "displayVariant": "original",
        "editableTitle": "04",
        "full": "0008-D5H_3435.jpg",
        "gallerySrc": "previews/common/corine-common-0008-d5h-3435_900.jpg",
        "id": "corine-common-0008-d5h-3435",
        "imageSrc": "previews/common/corine-common-0008-d5h-3435_1800.jpg",
        "media": {
          "publicPreview": {
            "allowed": true,
            "detailDimensions": {
              "height": 1200,
              "width": 1800
            },
            "detailKey": "RE/Corine/previews/common/corine-common-0008-d5h-3435_1800.jpg",
            "detailUrl": "previews/common/corine-common-0008-d5h-3435_1800.jpg",
            "dimensions": {
              "height": 600,
              "width": 900
            },
            "galleryKey": "RE/Corine/previews/common/corine-common-0008-d5h-3435_900.jpg",
            "galleryUrl": "previews/common/corine-common-0008-d5h-3435_900.jpg",
            "previewUrl": "previews/common/corine-common-0008-d5h-3435_1800.jpg",
            "thumbnailUrl": "previews/common/corine-common-0008-d5h-3435_900.jpg"
          },
          "type": "photo"
        },
        "metadata": [
          {
            "label": "Client",
            "value": "Corine"
          },
          {
            "label": "Album",
            "value": "Common"
          },
          {
            "label": "Original file",
            "value": "0008-D5H_3435.jpg"
          },
          {
            "label": "Original size",
            "value": "4176 x 2784"
          },
          {
            "label": "Preview 900",
            "value": "900 x 600"
          },
          {
            "label": "Preview 1800",
            "value": "1800 x 1200"
          }
        ],
        "sortIndex": 4,
        "title": "04"
      },
      {
        "album": "Common",
        "albumSlug": "common",
        "albumTitle": "Common",
        "caption": "Common",
        "captionColor": "434A36",
        "className": "real-estate-photo",
        "cloudPdfSource": {
          "bytes": 492023,
          "dimensions": {
            "height": 1200,
            "width": 1800
          },
          "imageUrl": "previews/common/corine-common-0010-d5h-3437_1800.jpg",
          "maxEdge": 1800,
          "mediaType": "photo",
          "publicKey": "RE/Corine/previews/common/corine-common-0010-d5h-3437_1800.jpg",
          "title": "05"
        },
        "displayVariant": "original",
        "editableTitle": "05",
        "full": "0010-D5H_3437.jpg",
        "gallerySrc": "previews/common/corine-common-0010-d5h-3437_900.jpg",
        "id": "corine-common-0010-d5h-3437",
        "imageSrc": "previews/common/corine-common-0010-d5h-3437_1800.jpg",
        "media": {
          "publicPreview": {
            "allowed": true,
            "detailDimensions": {
              "height": 1200,
              "width": 1800
            },
            "detailKey": "RE/Corine/previews/common/corine-common-0010-d5h-3437_1800.jpg",
            "detailUrl": "previews/common/corine-common-0010-d5h-3437_1800.jpg",
            "dimensions": {
              "height": 600,
              "width": 900
            },
            "galleryKey": "RE/Corine/previews/common/corine-common-0010-d5h-3437_900.jpg",
            "galleryUrl": "previews/common/corine-common-0010-d5h-3437_900.jpg",
            "previewUrl": "previews/common/corine-common-0010-d5h-3437_1800.jpg",
            "thumbnailUrl": "previews/common/corine-common-0010-d5h-3437_900.jpg"
          },
          "type": "photo"
        },
        "metadata": [
          {
            "label": "Client",
            "value": "Corine"
          },
          {
            "label": "Album",
            "value": "Common"
          },
          {
            "label": "Original file",
            "value": "0010-D5H_3437.jpg"
          },
          {
            "label": "Original size",
            "value": "4176 x 2784"
          },
          {
            "label": "Preview 900",
            "value": "900 x 600"
          },
          {
            "label": "Preview 1800",
            "value": "1800 x 1200"
          }
        ],
        "sortIndex": 5,
        "title": "05"
      },
      {
        "album": "Common",
        "albumSlug": "common",
        "albumTitle": "Common",
        "caption": "Common",
        "captionColor": "394835",
        "className": "real-estate-photo",
        "cloudPdfSource": {
          "bytes": 479455,
          "dimensions": {
            "height": 1200,
            "width": 1800
          },
          "imageUrl": "previews/common/corine-common-0013-d5h-3440_1800.jpg",
          "maxEdge": 1800,
          "mediaType": "photo",
          "publicKey": "RE/Corine/previews/common/corine-common-0013-d5h-3440_1800.jpg",
          "title": "06"
        },
        "displayVariant": "original",
        "editableTitle": "06",
        "full": "0013-D5H_3440.jpg",
        "gallerySrc": "previews/common/corine-common-0013-d5h-3440_900.jpg",
        "id": "corine-common-0013-d5h-3440",
        "imageSrc": "previews/common/corine-common-0013-d5h-3440_1800.jpg",
        "media": {
          "publicPreview": {
            "allowed": true,
            "detailDimensions": {
              "height": 1200,
              "width": 1800
            },
            "detailKey": "RE/Corine/previews/common/corine-common-0013-d5h-3440_1800.jpg",
            "detailUrl": "previews/common/corine-common-0013-d5h-3440_1800.jpg",
            "dimensions": {
              "height": 600,
              "width": 900
            },
            "galleryKey": "RE/Corine/previews/common/corine-common-0013-d5h-3440_900.jpg",
            "galleryUrl": "previews/common/corine-common-0013-d5h-3440_900.jpg",
            "previewUrl": "previews/common/corine-common-0013-d5h-3440_1800.jpg",
            "thumbnailUrl": "previews/common/corine-common-0013-d5h-3440_900.jpg"
          },
          "type": "photo"
        },
        "metadata": [
          {
            "label": "Client",
            "value": "Corine"
          },
          {
            "label": "Album",
            "value": "Common"
          },
          {
            "label": "Original file",
            "value": "0013-D5H_3440.jpg"
          },
          {
            "label": "Original size",
            "value": "4176 x 2784"
          },
          {
            "label": "Preview 900",
            "value": "900 x 600"
          },
          {
            "label": "Preview 1800",
            "value": "1800 x 1200"
          }
        ],
        "sortIndex": 6,
        "title": "06"
      },
      {
        "album": "Common",
        "albumSlug": "common",
        "albumTitle": "Common",
        "caption": "Common",
        "captionColor": "6C6F6B",
        "className": "real-estate-photo",
        "cloudPdfSource": {
          "bytes": 396937,
          "dimensions": {
            "height": 1200,
            "width": 1800
          },
          "imageUrl": "previews/common/corine-common-0015-d5h-3442_1800.jpg",
          "maxEdge": 1800,
          "mediaType": "photo",
          "publicKey": "RE/Corine/previews/common/corine-common-0015-d5h-3442_1800.jpg",
          "title": "07"
        },
        "displayVariant": "original",
        "editableTitle": "07",
        "full": "0015-D5H_3442.jpg",
        "gallerySrc": "previews/common/corine-common-0015-d5h-3442_900.jpg",
        "id": "corine-common-0015-d5h-3442",
        "imageSrc": "previews/common/corine-common-0015-d5h-3442_1800.jpg",
        "media": {
          "publicPreview": {
            "allowed": true,
            "detailDimensions": {
              "height": 1200,
              "width": 1800
            },
            "detailKey": "RE/Corine/previews/common/corine-common-0015-d5h-3442_1800.jpg",
            "detailUrl": "previews/common/corine-common-0015-d5h-3442_1800.jpg",
            "dimensions": {
              "height": 600,
              "width": 900
            },
            "galleryKey": "RE/Corine/previews/common/corine-common-0015-d5h-3442_900.jpg",
            "galleryUrl": "previews/common/corine-common-0015-d5h-3442_900.jpg",
            "previewUrl": "previews/common/corine-common-0015-d5h-3442_1800.jpg",
            "thumbnailUrl": "previews/common/corine-common-0015-d5h-3442_900.jpg"
          },
          "type": "photo"
        },
        "metadata": [
          {
            "label": "Client",
            "value": "Corine"
          },
          {
            "label": "Album",
            "value": "Common"
          },
          {
            "label": "Original file",
            "value": "0015-D5H_3442.jpg"
          },
          {
            "label": "Original size",
            "value": "4176 x 2784"
          },
          {
            "label": "Preview 900",
            "value": "900 x 600"
          },
          {
            "label": "Preview 1800",
            "value": "1800 x 1200"
          }
        ],
        "sortIndex": 7,
        "title": "07"
      },
      {
        "album": "Common",
        "albumSlug": "common",
        "albumTitle": "Common",
        "caption": "Common",
        "captionColor": "56585A",
        "className": "real-estate-photo",
        "cloudPdfSource": {
          "bytes": 492968,
          "dimensions": {
            "height": 1200,
            "width": 1800
          },
          "imageUrl": "previews/common/corine-common-0017-d5h-3444_1800.jpg",
          "maxEdge": 1800,
          "mediaType": "photo",
          "publicKey": "RE/Corine/previews/common/corine-common-0017-d5h-3444_1800.jpg",
          "title": "08"
        },
        "displayVariant": "original",
        "editableTitle": "08",
        "full": "0017-D5H_3444.jpg",
        "gallerySrc": "previews/common/corine-common-0017-d5h-3444_900.jpg",
        "id": "corine-common-0017-d5h-3444",
        "imageSrc": "previews/common/corine-common-0017-d5h-3444_1800.jpg",
        "media": {
          "publicPreview": {
            "allowed": true,
            "detailDimensions": {
              "height": 1200,
              "width": 1800
            },
            "detailKey": "RE/Corine/previews/common/corine-common-0017-d5h-3444_1800.jpg",
            "detailUrl": "previews/common/corine-common-0017-d5h-3444_1800.jpg",
            "dimensions": {
              "height": 600,
              "width": 900
            },
            "galleryKey": "RE/Corine/previews/common/corine-common-0017-d5h-3444_900.jpg",
            "galleryUrl": "previews/common/corine-common-0017-d5h-3444_900.jpg",
            "previewUrl": "previews/common/corine-common-0017-d5h-3444_1800.jpg",
            "thumbnailUrl": "previews/common/corine-common-0017-d5h-3444_900.jpg"
          },
          "type": "photo"
        },
        "metadata": [
          {
            "label": "Client",
            "value": "Corine"
          },
          {
            "label": "Album",
            "value": "Common"
          },
          {
            "label": "Original file",
            "value": "0017-D5H_3444.jpg"
          },
          {
            "label": "Original size",
            "value": "4176 x 2784"
          },
          {
            "label": "Preview 900",
            "value": "900 x 600"
          },
          {
            "label": "Preview 1800",
            "value": "1800 x 1200"
          }
        ],
        "sortIndex": 8,
        "title": "08"
      },
      {
        "album": "Common",
        "albumSlug": "common",
        "albumTitle": "Common",
        "caption": "Common",
        "captionColor": "5A5E61",
        "className": "real-estate-photo",
        "cloudPdfSource": {
          "bytes": 490342,
          "dimensions": {
            "height": 1200,
            "width": 1800
          },
          "imageUrl": "previews/common/corine-common-0019-d5h-3446_1800.jpg",
          "maxEdge": 1800,
          "mediaType": "photo",
          "publicKey": "RE/Corine/previews/common/corine-common-0019-d5h-3446_1800.jpg",
          "title": "09"
        },
        "displayVariant": "original",
        "editableTitle": "09",
        "full": "0019-D5H_3446.jpg",
        "gallerySrc": "previews/common/corine-common-0019-d5h-3446_900.jpg",
        "id": "corine-common-0019-d5h-3446",
        "imageSrc": "previews/common/corine-common-0019-d5h-3446_1800.jpg",
        "media": {
          "publicPreview": {
            "allowed": true,
            "detailDimensions": {
              "height": 1200,
              "width": 1800
            },
            "detailKey": "RE/Corine/previews/common/corine-common-0019-d5h-3446_1800.jpg",
            "detailUrl": "previews/common/corine-common-0019-d5h-3446_1800.jpg",
            "dimensions": {
              "height": 600,
              "width": 900
            },
            "galleryKey": "RE/Corine/previews/common/corine-common-0019-d5h-3446_900.jpg",
            "galleryUrl": "previews/common/corine-common-0019-d5h-3446_900.jpg",
            "previewUrl": "previews/common/corine-common-0019-d5h-3446_1800.jpg",
            "thumbnailUrl": "previews/common/corine-common-0019-d5h-3446_900.jpg"
          },
          "type": "photo"
        },
        "metadata": [
          {
            "label": "Client",
            "value": "Corine"
          },
          {
            "label": "Album",
            "value": "Common"
          },
          {
            "label": "Original file",
            "value": "0019-D5H_3446.jpg"
          },
          {
            "label": "Original size",
            "value": "4176 x 2784"
          },
          {
            "label": "Preview 900",
            "value": "900 x 600"
          },
          {
            "label": "Preview 1800",
            "value": "1800 x 1200"
          }
        ],
        "sortIndex": 9,
        "title": "09"
      },
      {
        "album": "Common",
        "albumSlug": "common",
        "albumTitle": "Common",
        "caption": "Common",
        "captionColor": "6F6157",
        "className": "real-estate-photo",
        "cloudPdfSource": {
          "bytes": 282411,
          "dimensions": {
            "height": 1200,
            "width": 1800
          },
          "imageUrl": "previews/common/corine-common-0021-d5h-3448_1800.jpg",
          "maxEdge": 1800,
          "mediaType": "photo",
          "publicKey": "RE/Corine/previews/common/corine-common-0021-d5h-3448_1800.jpg",
          "title": "10"
        },
        "displayVariant": "original",
        "editableTitle": "10",
        "full": "0021-D5H_3448.jpg",
        "gallerySrc": "previews/common/corine-common-0021-d5h-3448_900.jpg",
        "id": "corine-common-0021-d5h-3448",
        "imageSrc": "previews/common/corine-common-0021-d5h-3448_1800.jpg",
        "media": {
          "publicPreview": {
            "allowed": true,
            "detailDimensions": {
              "height": 1200,
              "width": 1800
            },
            "detailKey": "RE/Corine/previews/common/corine-common-0021-d5h-3448_1800.jpg",
            "detailUrl": "previews/common/corine-common-0021-d5h-3448_1800.jpg",
            "dimensions": {
              "height": 600,
              "width": 900
            },
            "galleryKey": "RE/Corine/previews/common/corine-common-0021-d5h-3448_900.jpg",
            "galleryUrl": "previews/common/corine-common-0021-d5h-3448_900.jpg",
            "previewUrl": "previews/common/corine-common-0021-d5h-3448_1800.jpg",
            "thumbnailUrl": "previews/common/corine-common-0021-d5h-3448_900.jpg"
          },
          "type": "photo"
        },
        "metadata": [
          {
            "label": "Client",
            "value": "Corine"
          },
          {
            "label": "Album",
            "value": "Common"
          },
          {
            "label": "Original file",
            "value": "0021-D5H_3448.jpg"
          },
          {
            "label": "Original size",
            "value": "4176 x 2784"
          },
          {
            "label": "Preview 900",
            "value": "900 x 600"
          },
          {
            "label": "Preview 1800",
            "value": "1800 x 1200"
          }
        ],
        "sortIndex": 10,
        "title": "10"
      },
      {
        "album": "Common",
        "albumSlug": "common",
        "albumTitle": "Common",
        "caption": "Common",
        "captionColor": "8C7C76",
        "className": "real-estate-photo",
        "cloudPdfSource": {
          "bytes": 316231,
          "dimensions": {
            "height": 1800,
            "width": 1200
          },
          "imageUrl": "previews/common/corine-common-0023-d5h-3450_1800.jpg",
          "maxEdge": 1800,
          "mediaType": "photo",
          "publicKey": "RE/Corine/previews/common/corine-common-0023-d5h-3450_1800.jpg",
          "title": "11"
        },
        "displayVariant": "original",
        "editableTitle": "11",
        "full": "0023-D5H_3450.jpg",
        "gallerySrc": "previews/common/corine-common-0023-d5h-3450_900.jpg",
        "id": "corine-common-0023-d5h-3450",
        "imageSrc": "previews/common/corine-common-0023-d5h-3450_1800.jpg",
        "media": {
          "publicPreview": {
            "allowed": true,
            "detailDimensions": {
              "height": 1800,
              "width": 1200
            },
            "detailKey": "RE/Corine/previews/common/corine-common-0023-d5h-3450_1800.jpg",
            "detailUrl": "previews/common/corine-common-0023-d5h-3450_1800.jpg",
            "dimensions": {
              "height": 900,
              "width": 600
            },
            "galleryKey": "RE/Corine/previews/common/corine-common-0023-d5h-3450_900.jpg",
            "galleryUrl": "previews/common/corine-common-0023-d5h-3450_900.jpg",
            "previewUrl": "previews/common/corine-common-0023-d5h-3450_1800.jpg",
            "thumbnailUrl": "previews/common/corine-common-0023-d5h-3450_900.jpg"
          },
          "type": "photo"
        },
        "metadata": [
          {
            "label": "Client",
            "value": "Corine"
          },
          {
            "label": "Album",
            "value": "Common"
          },
          {
            "label": "Original file",
            "value": "0023-D5H_3450.jpg"
          },
          {
            "label": "Original size",
            "value": "2784 x 4176"
          },
          {
            "label": "Preview 900",
            "value": "600 x 900"
          },
          {
            "label": "Preview 1800",
            "value": "1200 x 1800"
          }
        ],
        "sortIndex": 11,
        "title": "11"
      },
      {
        "album": "Common",
        "albumSlug": "common",
        "albumTitle": "Common",
        "caption": "Common",
        "captionColor": "746F6E",
        "className": "real-estate-photo",
        "cloudPdfSource": {
          "bytes": 377613,
          "dimensions": {
            "height": 1200,
            "width": 1800
          },
          "imageUrl": "previews/common/corine-common-0025-d5h-3452_1800.jpg",
          "maxEdge": 1800,
          "mediaType": "photo",
          "publicKey": "RE/Corine/previews/common/corine-common-0025-d5h-3452_1800.jpg",
          "title": "12"
        },
        "displayVariant": "original",
        "editableTitle": "12",
        "full": "0025-D5H_3452.jpg",
        "gallerySrc": "previews/common/corine-common-0025-d5h-3452_900.jpg",
        "id": "corine-common-0025-d5h-3452",
        "imageSrc": "previews/common/corine-common-0025-d5h-3452_1800.jpg",
        "media": {
          "publicPreview": {
            "allowed": true,
            "detailDimensions": {
              "height": 1200,
              "width": 1800
            },
            "detailKey": "RE/Corine/previews/common/corine-common-0025-d5h-3452_1800.jpg",
            "detailUrl": "previews/common/corine-common-0025-d5h-3452_1800.jpg",
            "dimensions": {
              "height": 600,
              "width": 900
            },
            "galleryKey": "RE/Corine/previews/common/corine-common-0025-d5h-3452_900.jpg",
            "galleryUrl": "previews/common/corine-common-0025-d5h-3452_900.jpg",
            "previewUrl": "previews/common/corine-common-0025-d5h-3452_1800.jpg",
            "thumbnailUrl": "previews/common/corine-common-0025-d5h-3452_900.jpg"
          },
          "type": "photo"
        },
        "metadata": [
          {
            "label": "Client",
            "value": "Corine"
          },
          {
            "label": "Album",
            "value": "Common"
          },
          {
            "label": "Original file",
            "value": "0025-D5H_3452.jpg"
          },
          {
            "label": "Original size",
            "value": "4176 x 2784"
          },
          {
            "label": "Preview 900",
            "value": "900 x 600"
          },
          {
            "label": "Preview 1800",
            "value": "1800 x 1200"
          }
        ],
        "sortIndex": 12,
        "title": "12"
      },
      {
        "album": "Common",
        "albumSlug": "common",
        "albumTitle": "Common",
        "caption": "Common",
        "captionColor": "584E42",
        "className": "real-estate-photo",
        "cloudPdfSource": {
          "bytes": 306641,
          "dimensions": {
            "height": 1200,
            "width": 1800
          },
          "imageUrl": "previews/common/corine-common-0027-d5h-3454_1800.jpg",
          "maxEdge": 1800,
          "mediaType": "photo",
          "publicKey": "RE/Corine/previews/common/corine-common-0027-d5h-3454_1800.jpg",
          "title": "13"
        },
        "displayVariant": "original",
        "editableTitle": "13",
        "full": "0027-D5H_3454.jpg",
        "gallerySrc": "previews/common/corine-common-0027-d5h-3454_900.jpg",
        "id": "corine-common-0027-d5h-3454",
        "imageSrc": "previews/common/corine-common-0027-d5h-3454_1800.jpg",
        "media": {
          "publicPreview": {
            "allowed": true,
            "detailDimensions": {
              "height": 1200,
              "width": 1800
            },
            "detailKey": "RE/Corine/previews/common/corine-common-0027-d5h-3454_1800.jpg",
            "detailUrl": "previews/common/corine-common-0027-d5h-3454_1800.jpg",
            "dimensions": {
              "height": 600,
              "width": 900
            },
            "galleryKey": "RE/Corine/previews/common/corine-common-0027-d5h-3454_900.jpg",
            "galleryUrl": "previews/common/corine-common-0027-d5h-3454_900.jpg",
            "previewUrl": "previews/common/corine-common-0027-d5h-3454_1800.jpg",
            "thumbnailUrl": "previews/common/corine-common-0027-d5h-3454_900.jpg"
          },
          "type": "photo"
        },
        "metadata": [
          {
            "label": "Client",
            "value": "Corine"
          },
          {
            "label": "Album",
            "value": "Common"
          },
          {
            "label": "Original file",
            "value": "0027-D5H_3454.jpg"
          },
          {
            "label": "Original size",
            "value": "4176 x 2784"
          },
          {
            "label": "Preview 900",
            "value": "900 x 600"
          },
          {
            "label": "Preview 1800",
            "value": "1800 x 1200"
          }
        ],
        "sortIndex": 13,
        "title": "13"
      },
      {
        "album": "Common",
        "albumSlug": "common",
        "albumTitle": "Common",
        "caption": "Common",
        "captionColor": "32271C",
        "className": "real-estate-photo",
        "cloudPdfSource": {
          "bytes": 409173,
          "dimensions": {
            "height": 1200,
            "width": 1800
          },
          "imageUrl": "previews/common/corine-common-0030-d5h-3457_1800.jpg",
          "maxEdge": 1800,
          "mediaType": "photo",
          "publicKey": "RE/Corine/previews/common/corine-common-0030-d5h-3457_1800.jpg",
          "title": "14"
        },
        "displayVariant": "original",
        "editableTitle": "14",
        "full": "0030-D5H_3457.jpg",
        "gallerySrc": "previews/common/corine-common-0030-d5h-3457_900.jpg",
        "id": "corine-common-0030-d5h-3457",
        "imageSrc": "previews/common/corine-common-0030-d5h-3457_1800.jpg",
        "media": {
          "publicPreview": {
            "allowed": true,
            "detailDimensions": {
              "height": 1200,
              "width": 1800
            },
            "detailKey": "RE/Corine/previews/common/corine-common-0030-d5h-3457_1800.jpg",
            "detailUrl": "previews/common/corine-common-0030-d5h-3457_1800.jpg",
            "dimensions": {
              "height": 600,
              "width": 900
            },
            "galleryKey": "RE/Corine/previews/common/corine-common-0030-d5h-3457_900.jpg",
            "galleryUrl": "previews/common/corine-common-0030-d5h-3457_900.jpg",
            "previewUrl": "previews/common/corine-common-0030-d5h-3457_1800.jpg",
            "thumbnailUrl": "previews/common/corine-common-0030-d5h-3457_900.jpg"
          },
          "type": "photo"
        },
        "metadata": [
          {
            "label": "Client",
            "value": "Corine"
          },
          {
            "label": "Album",
            "value": "Common"
          },
          {
            "label": "Original file",
            "value": "0030-D5H_3457.jpg"
          },
          {
            "label": "Original size",
            "value": "4176 x 2784"
          },
          {
            "label": "Preview 900",
            "value": "900 x 600"
          },
          {
            "label": "Preview 1800",
            "value": "1800 x 1200"
          }
        ],
        "sortIndex": 14,
        "title": "14"
      },
      {
        "album": "Showcase",
        "albumSlug": "showcase",
        "albumTitle": "Showcase",
        "caption": "Showcase",
        "captionColor": "958E8B",
        "className": "real-estate-photo",
        "cloudPdfSource": {
          "bytes": 205467,
          "dimensions": {
            "height": 1023,
            "width": 1537
          },
          "imageUrl": "previews/showcase/corine-showcase-d5h-2976_1800.jpg",
          "maxEdge": 1800,
          "mediaType": "photo",
          "publicKey": "RE/Corine/previews/showcase/corine-showcase-d5h-2976_1800.jpg",
          "title": "01"
        },
        "displayVariant": "approved-rework",
        "editableTitle": "01",
        "full": "D5H_2976.jpg",
        "gallerySrc": "previews/showcase/corine-showcase-d5h-2976_900.jpg",
        "id": "corine-showcase-d5h-2976",
        "imageSrc": "previews/showcase/corine-showcase-d5h-2976_1800.jpg",
        "media": {
          "publicPreview": {
            "allowed": true,
            "detailDimensions": {
              "height": 1023,
              "width": 1537
            },
            "detailKey": "RE/Corine/previews/showcase/corine-showcase-d5h-2976_1800.jpg",
            "detailUrl": "previews/showcase/corine-showcase-d5h-2976_1800.jpg",
            "dimensions": {
              "height": 599,
              "width": 900
            },
            "galleryKey": "RE/Corine/previews/showcase/corine-showcase-d5h-2976_900.jpg",
            "galleryUrl": "previews/showcase/corine-showcase-d5h-2976_900.jpg",
            "previewUrl": "previews/showcase/corine-showcase-d5h-2976_1800.jpg",
            "thumbnailUrl": "previews/showcase/corine-showcase-d5h-2976_900.jpg"
          },
          "type": "photo"
        },
        "metadata": [
          {
            "label": "Client",
            "value": "Corine"
          },
          {
            "label": "Album",
            "value": "Showcase"
          },
          {
            "label": "Original file",
            "value": "D5H_2976.jpg"
          },
          {
            "label": "Original size",
            "value": "1800 x 1200"
          },
          {
            "label": "Preview 900",
            "value": "900 x 599"
          },
          {
            "label": "Preview 1800",
            "value": "1537 x 1023"
          }
        ],
        "sortIndex": 15,
        "title": "01"
      },
      {
        "album": "Showcase",
        "albumSlug": "showcase",
        "albumTitle": "Showcase",
        "caption": "Showcase",
        "captionColor": "AE9E90",
        "className": "real-estate-photo",
        "cloudPdfSource": {
          "bytes": 276143,
          "dimensions": {
            "height": 1024,
            "width": 1536
          },
          "imageUrl": "previews/showcase/corine-showcase-d5h-2985_1800.jpg",
          "maxEdge": 1800,
          "mediaType": "photo",
          "publicKey": "RE/Corine/previews/showcase/corine-showcase-d5h-2985_1800.jpg",
          "title": "02"
        },
        "displayVariant": "approved-rework",
        "editableTitle": "02",
        "full": "D5H_2985.jpg",
        "gallerySrc": "previews/showcase/corine-showcase-d5h-2985_900.jpg",
        "id": "corine-showcase-d5h-2985",
        "imageSrc": "previews/showcase/corine-showcase-d5h-2985_1800.jpg",
        "media": {
          "publicPreview": {
            "allowed": true,
            "detailDimensions": {
              "height": 1024,
              "width": 1536
            },
            "detailKey": "RE/Corine/previews/showcase/corine-showcase-d5h-2985_1800.jpg",
            "detailUrl": "previews/showcase/corine-showcase-d5h-2985_1800.jpg",
            "dimensions": {
              "height": 600,
              "width": 900
            },
            "galleryKey": "RE/Corine/previews/showcase/corine-showcase-d5h-2985_900.jpg",
            "galleryUrl": "previews/showcase/corine-showcase-d5h-2985_900.jpg",
            "previewUrl": "previews/showcase/corine-showcase-d5h-2985_1800.jpg",
            "thumbnailUrl": "previews/showcase/corine-showcase-d5h-2985_900.jpg"
          },
          "type": "photo"
        },
        "metadata": [
          {
            "label": "Client",
            "value": "Corine"
          },
          {
            "label": "Album",
            "value": "Showcase"
          },
          {
            "label": "Original file",
            "value": "D5H_2985.jpg"
          },
          {
            "label": "Original size",
            "value": "1800 x 1200"
          },
          {
            "label": "Preview 900",
            "value": "900 x 600"
          },
          {
            "label": "Preview 1800",
            "value": "1536 x 1024"
          }
        ],
        "sortIndex": 16,
        "title": "02"
      },
      {
        "album": "Showcase",
        "albumSlug": "showcase",
        "albumTitle": "Showcase",
        "caption": "Showcase",
        "captionColor": "A3A9BC",
        "className": "real-estate-photo",
        "cloudPdfSource": {
          "bytes": 263672,
          "dimensions": {
            "height": 1024,
            "width": 1536
          },
          "imageUrl": "previews/showcase/corine-showcase-d5h-3008_1800.jpg",
          "maxEdge": 1800,
          "mediaType": "photo",
          "publicKey": "RE/Corine/previews/showcase/corine-showcase-d5h-3008_1800.jpg",
          "title": "03"
        },
        "displayVariant": "approved-rework",
        "editableTitle": "03",
        "full": "D5H_3008.jpg",
        "gallerySrc": "previews/showcase/corine-showcase-d5h-3008_900.jpg",
        "id": "corine-showcase-d5h-3008",
        "imageSrc": "previews/showcase/corine-showcase-d5h-3008_1800.jpg",
        "media": {
          "publicPreview": {
            "allowed": true,
            "detailDimensions": {
              "height": 1024,
              "width": 1536
            },
            "detailKey": "RE/Corine/previews/showcase/corine-showcase-d5h-3008_1800.jpg",
            "detailUrl": "previews/showcase/corine-showcase-d5h-3008_1800.jpg",
            "dimensions": {
              "height": 600,
              "width": 900
            },
            "galleryKey": "RE/Corine/previews/showcase/corine-showcase-d5h-3008_900.jpg",
            "galleryUrl": "previews/showcase/corine-showcase-d5h-3008_900.jpg",
            "previewUrl": "previews/showcase/corine-showcase-d5h-3008_1800.jpg",
            "thumbnailUrl": "previews/showcase/corine-showcase-d5h-3008_900.jpg"
          },
          "type": "photo"
        },
        "metadata": [
          {
            "label": "Client",
            "value": "Corine"
          },
          {
            "label": "Album",
            "value": "Showcase"
          },
          {
            "label": "Original file",
            "value": "D5H_3008.jpg"
          },
          {
            "label": "Original size",
            "value": "1800 x 1200"
          },
          {
            "label": "Preview 900",
            "value": "900 x 600"
          },
          {
            "label": "Preview 1800",
            "value": "1536 x 1024"
          }
        ],
        "sortIndex": 17,
        "title": "03"
      },
      {
        "album": "Showcase",
        "albumSlug": "showcase",
        "albumTitle": "Showcase",
        "caption": "Showcase",
        "captionColor": "696E54",
        "className": "real-estate-photo",
        "cloudPdfSource": {
          "bytes": 475412,
          "dimensions": {
            "height": 1024,
            "width": 1536
          },
          "imageUrl": "previews/showcase/corine-showcase-d5h-3045_1800.jpg",
          "maxEdge": 1800,
          "mediaType": "photo",
          "publicKey": "RE/Corine/previews/showcase/corine-showcase-d5h-3045_1800.jpg",
          "title": "04"
        },
        "displayVariant": "approved-rework",
        "editableTitle": "04",
        "full": "D5H_3045.jpg",
        "gallerySrc": "previews/showcase/corine-showcase-d5h-3045_900.jpg",
        "id": "corine-showcase-d5h-3045",
        "imageSrc": "previews/showcase/corine-showcase-d5h-3045_1800.jpg",
        "media": {
          "publicPreview": {
            "allowed": true,
            "detailDimensions": {
              "height": 1024,
              "width": 1536
            },
            "detailKey": "RE/Corine/previews/showcase/corine-showcase-d5h-3045_1800.jpg",
            "detailUrl": "previews/showcase/corine-showcase-d5h-3045_1800.jpg",
            "dimensions": {
              "height": 600,
              "width": 900
            },
            "galleryKey": "RE/Corine/previews/showcase/corine-showcase-d5h-3045_900.jpg",
            "galleryUrl": "previews/showcase/corine-showcase-d5h-3045_900.jpg",
            "previewUrl": "previews/showcase/corine-showcase-d5h-3045_1800.jpg",
            "thumbnailUrl": "previews/showcase/corine-showcase-d5h-3045_900.jpg"
          },
          "type": "photo"
        },
        "metadata": [
          {
            "label": "Client",
            "value": "Corine"
          },
          {
            "label": "Album",
            "value": "Showcase"
          },
          {
            "label": "Original file",
            "value": "D5H_3045.jpg"
          },
          {
            "label": "Original size",
            "value": "1800 x 1200"
          },
          {
            "label": "Preview 900",
            "value": "900 x 600"
          },
          {
            "label": "Preview 1800",
            "value": "1536 x 1024"
          }
        ],
        "sortIndex": 18,
        "title": "04"
      },
      {
        "album": "Showcase",
        "albumSlug": "showcase",
        "albumTitle": "Showcase",
        "caption": "Showcase",
        "captionColor": "8B7460",
        "className": "real-estate-photo",
        "cloudPdfSource": {
          "bytes": 276655,
          "dimensions": {
            "height": 1024,
            "width": 1536
          },
          "imageUrl": "previews/showcase/corine-showcase-d5h-3078_1800.jpg",
          "maxEdge": 1800,
          "mediaType": "photo",
          "publicKey": "RE/Corine/previews/showcase/corine-showcase-d5h-3078_1800.jpg",
          "title": "05"
        },
        "displayVariant": "approved-rework",
        "editableTitle": "05",
        "full": "D5H_3078.jpg",
        "gallerySrc": "previews/showcase/corine-showcase-d5h-3078_900.jpg",
        "id": "corine-showcase-d5h-3078",
        "imageSrc": "previews/showcase/corine-showcase-d5h-3078_1800.jpg",
        "media": {
          "publicPreview": {
            "allowed": true,
            "detailDimensions": {
              "height": 1024,
              "width": 1536
            },
            "detailKey": "RE/Corine/previews/showcase/corine-showcase-d5h-3078_1800.jpg",
            "detailUrl": "previews/showcase/corine-showcase-d5h-3078_1800.jpg",
            "dimensions": {
              "height": 600,
              "width": 900
            },
            "galleryKey": "RE/Corine/previews/showcase/corine-showcase-d5h-3078_900.jpg",
            "galleryUrl": "previews/showcase/corine-showcase-d5h-3078_900.jpg",
            "previewUrl": "previews/showcase/corine-showcase-d5h-3078_1800.jpg",
            "thumbnailUrl": "previews/showcase/corine-showcase-d5h-3078_900.jpg"
          },
          "type": "photo"
        },
        "metadata": [
          {
            "label": "Client",
            "value": "Corine"
          },
          {
            "label": "Album",
            "value": "Showcase"
          },
          {
            "label": "Original file",
            "value": "D5H_3078.jpg"
          },
          {
            "label": "Original size",
            "value": "1800 x 1200"
          },
          {
            "label": "Preview 900",
            "value": "900 x 600"
          },
          {
            "label": "Preview 1800",
            "value": "1536 x 1024"
          }
        ],
        "sortIndex": 19,
        "title": "05"
      },
      {
        "album": "Showcase",
        "albumSlug": "showcase",
        "albumTitle": "Showcase",
        "caption": "Showcase",
        "captionColor": "A3988E",
        "className": "real-estate-photo",
        "cloudPdfSource": {
          "bytes": 290276,
          "dimensions": {
            "height": 1024,
            "width": 1536
          },
          "imageUrl": "previews/showcase/corine-showcase-d5h-3085_1800.jpg",
          "maxEdge": 1800,
          "mediaType": "photo",
          "publicKey": "RE/Corine/previews/showcase/corine-showcase-d5h-3085_1800.jpg",
          "title": "06"
        },
        "displayVariant": "approved-rework",
        "editableTitle": "06",
        "full": "D5H_3085.jpg",
        "gallerySrc": "previews/showcase/corine-showcase-d5h-3085_900.jpg",
        "id": "corine-showcase-d5h-3085",
        "imageSrc": "previews/showcase/corine-showcase-d5h-3085_1800.jpg",
        "media": {
          "publicPreview": {
            "allowed": true,
            "detailDimensions": {
              "height": 1024,
              "width": 1536
            },
            "detailKey": "RE/Corine/previews/showcase/corine-showcase-d5h-3085_1800.jpg",
            "detailUrl": "previews/showcase/corine-showcase-d5h-3085_1800.jpg",
            "dimensions": {
              "height": 600,
              "width": 900
            },
            "galleryKey": "RE/Corine/previews/showcase/corine-showcase-d5h-3085_900.jpg",
            "galleryUrl": "previews/showcase/corine-showcase-d5h-3085_900.jpg",
            "previewUrl": "previews/showcase/corine-showcase-d5h-3085_1800.jpg",
            "thumbnailUrl": "previews/showcase/corine-showcase-d5h-3085_900.jpg"
          },
          "type": "photo"
        },
        "metadata": [
          {
            "label": "Client",
            "value": "Corine"
          },
          {
            "label": "Album",
            "value": "Showcase"
          },
          {
            "label": "Original file",
            "value": "D5H_3085.jpg"
          },
          {
            "label": "Original size",
            "value": "1800 x 1200"
          },
          {
            "label": "Preview 900",
            "value": "900 x 600"
          },
          {
            "label": "Preview 1800",
            "value": "1536 x 1024"
          }
        ],
        "sortIndex": 20,
        "title": "06"
      },
      {
        "album": "Showcase",
        "albumSlug": "showcase",
        "albumTitle": "Showcase",
        "caption": "Showcase",
        "captionColor": "847365",
        "className": "real-estate-photo",
        "cloudPdfSource": {
          "bytes": 217561,
          "dimensions": {
            "height": 1024,
            "width": 1536
          },
          "imageUrl": "previews/showcase/corine-showcase-d5h-3087_1800.jpg",
          "maxEdge": 1800,
          "mediaType": "photo",
          "publicKey": "RE/Corine/previews/showcase/corine-showcase-d5h-3087_1800.jpg",
          "title": "07"
        },
        "displayVariant": "approved-rework",
        "editableTitle": "07",
        "full": "D5H_3087.jpg",
        "gallerySrc": "previews/showcase/corine-showcase-d5h-3087_900.jpg",
        "id": "corine-showcase-d5h-3087",
        "imageSrc": "previews/showcase/corine-showcase-d5h-3087_1800.jpg",
        "media": {
          "publicPreview": {
            "allowed": true,
            "detailDimensions": {
              "height": 1024,
              "width": 1536
            },
            "detailKey": "RE/Corine/previews/showcase/corine-showcase-d5h-3087_1800.jpg",
            "detailUrl": "previews/showcase/corine-showcase-d5h-3087_1800.jpg",
            "dimensions": {
              "height": 600,
              "width": 900
            },
            "galleryKey": "RE/Corine/previews/showcase/corine-showcase-d5h-3087_900.jpg",
            "galleryUrl": "previews/showcase/corine-showcase-d5h-3087_900.jpg",
            "previewUrl": "previews/showcase/corine-showcase-d5h-3087_1800.jpg",
            "thumbnailUrl": "previews/showcase/corine-showcase-d5h-3087_900.jpg"
          },
          "type": "photo"
        },
        "metadata": [
          {
            "label": "Client",
            "value": "Corine"
          },
          {
            "label": "Album",
            "value": "Showcase"
          },
          {
            "label": "Original file",
            "value": "D5H_3087.jpg"
          },
          {
            "label": "Original size",
            "value": "1800 x 1200"
          },
          {
            "label": "Preview 900",
            "value": "900 x 600"
          },
          {
            "label": "Preview 1800",
            "value": "1536 x 1024"
          }
        ],
        "sortIndex": 21,
        "title": "07"
      },
      {
        "album": "Showcase",
        "albumSlug": "showcase",
        "albumTitle": "Showcase",
        "caption": "Showcase",
        "captionColor": "9B948C",
        "className": "real-estate-photo",
        "cloudPdfSource": {
          "bytes": 95174,
          "dimensions": {
            "height": 423,
            "width": 1182
          },
          "imageUrl": "previews/showcase/corine-showcase-corine-sea-view-panorama_1800.jpg",
          "maxEdge": 1800,
          "mediaType": "photo",
          "publicKey": "RE/Corine/previews/showcase/corine-showcase-corine-sea-view-panorama_1800.jpg",
          "title": "08"
        },
        "displayVariant": "original",
        "editableTitle": "08",
        "full": "corine-sea-view-panorama.jpg",
        "gallerySrc": "previews/showcase/corine-showcase-corine-sea-view-panorama_900.jpg",
        "id": "corine-showcase-corine-sea-view-panorama",
        "imageSrc": "previews/showcase/corine-showcase-corine-sea-view-panorama_1800.jpg",
        "media": {
          "publicPreview": {
            "allowed": true,
            "detailDimensions": {
              "height": 423,
              "width": 1182
            },
            "detailKey": "RE/Corine/previews/showcase/corine-showcase-corine-sea-view-panorama_1800.jpg",
            "detailUrl": "previews/showcase/corine-showcase-corine-sea-view-panorama_1800.jpg",
            "dimensions": {
              "height": 322,
              "width": 900
            },
            "galleryKey": "RE/Corine/previews/showcase/corine-showcase-corine-sea-view-panorama_900.jpg",
            "galleryUrl": "previews/showcase/corine-showcase-corine-sea-view-panorama_900.jpg",
            "previewUrl": "previews/showcase/corine-showcase-corine-sea-view-panorama_1800.jpg",
            "thumbnailUrl": "previews/showcase/corine-showcase-corine-sea-view-panorama_900.jpg"
          },
          "type": "photo"
        },
        "metadata": [
          {
            "label": "Client",
            "value": "Corine"
          },
          {
            "label": "Album",
            "value": "Showcase"
          },
          {
            "label": "Original file",
            "value": "corine-sea-view-panorama.jpg"
          },
          {
            "label": "Original size",
            "value": "1182 x 423"
          },
          {
            "label": "Preview 900",
            "value": "900 x 322"
          },
          {
            "label": "Preview 1800",
            "value": "1182 x 423"
          }
        ],
        "sortIndex": 22,
        "title": "08"
      }
    ],
    "title": "La Concha"
  },
  "generatedAt": "2026-07-18T09:25:01+00:00",
  "photos": [
    {
      "album": "Common",
      "albumSlug": "common",
      "albumTitle": "Common",
      "caption": "Common",
      "captionColor": "939C7F",
      "className": "real-estate-photo",
      "cloudPdfSource": {
        "bytes": 404449,
        "dimensions": {
          "height": 1200,
          "width": 1800
        },
        "imageUrl": "previews/common/corine-common-0002-d5h-3429_1800.jpg",
        "maxEdge": 1800,
        "mediaType": "photo",
        "publicKey": "RE/Corine/previews/common/corine-common-0002-d5h-3429_1800.jpg",
        "title": "01"
      },
      "displayVariant": "original",
      "editableTitle": "01",
      "full": "0002-D5H_3429.jpg",
      "gallerySrc": "previews/common/corine-common-0002-d5h-3429_900.jpg",
      "id": "corine-common-0002-d5h-3429",
      "imageSrc": "previews/common/corine-common-0002-d5h-3429_1800.jpg",
      "media": {
        "publicPreview": {
          "allowed": true,
          "detailDimensions": {
            "height": 1200,
            "width": 1800
          },
          "detailKey": "RE/Corine/previews/common/corine-common-0002-d5h-3429_1800.jpg",
          "detailUrl": "previews/common/corine-common-0002-d5h-3429_1800.jpg",
          "dimensions": {
            "height": 600,
            "width": 900
          },
          "galleryKey": "RE/Corine/previews/common/corine-common-0002-d5h-3429_900.jpg",
          "galleryUrl": "previews/common/corine-common-0002-d5h-3429_900.jpg",
          "previewUrl": "previews/common/corine-common-0002-d5h-3429_1800.jpg",
          "thumbnailUrl": "previews/common/corine-common-0002-d5h-3429_900.jpg"
        },
        "type": "photo"
      },
      "metadata": [
        {
          "label": "Client",
          "value": "Corine"
        },
        {
          "label": "Album",
          "value": "Common"
        },
        {
          "label": "Original file",
          "value": "0002-D5H_3429.jpg"
        },
        {
          "label": "Original size",
          "value": "4176 x 2784"
        },
        {
          "label": "Preview 900",
          "value": "900 x 600"
        },
        {
          "label": "Preview 1800",
          "value": "1800 x 1200"
        }
      ],
      "sortIndex": 1,
      "title": "01"
    },
    {
      "album": "Common",
      "albumSlug": "common",
      "albumTitle": "Common",
      "caption": "Common",
      "captionColor": "A0937E",
      "className": "real-estate-photo",
      "cloudPdfSource": {
        "bytes": 480600,
        "dimensions": {
          "height": 1200,
          "width": 1800
        },
        "imageUrl": "previews/common/corine-common-0004-d5h-3431_1800.jpg",
        "maxEdge": 1800,
        "mediaType": "photo",
        "publicKey": "RE/Corine/previews/common/corine-common-0004-d5h-3431_1800.jpg",
        "title": "02"
      },
      "displayVariant": "original",
      "editableTitle": "02",
      "full": "0004-D5H_3431.jpg",
      "gallerySrc": "previews/common/corine-common-0004-d5h-3431_900.jpg",
      "id": "corine-common-0004-d5h-3431",
      "imageSrc": "previews/common/corine-common-0004-d5h-3431_1800.jpg",
      "media": {
        "publicPreview": {
          "allowed": true,
          "detailDimensions": {
            "height": 1200,
            "width": 1800
          },
          "detailKey": "RE/Corine/previews/common/corine-common-0004-d5h-3431_1800.jpg",
          "detailUrl": "previews/common/corine-common-0004-d5h-3431_1800.jpg",
          "dimensions": {
            "height": 600,
            "width": 900
          },
          "galleryKey": "RE/Corine/previews/common/corine-common-0004-d5h-3431_900.jpg",
          "galleryUrl": "previews/common/corine-common-0004-d5h-3431_900.jpg",
          "previewUrl": "previews/common/corine-common-0004-d5h-3431_1800.jpg",
          "thumbnailUrl": "previews/common/corine-common-0004-d5h-3431_900.jpg"
        },
        "type": "photo"
      },
      "metadata": [
        {
          "label": "Client",
          "value": "Corine"
        },
        {
          "label": "Album",
          "value": "Common"
        },
        {
          "label": "Original file",
          "value": "0004-D5H_3431.jpg"
        },
        {
          "label": "Original size",
          "value": "4176 x 2784"
        },
        {
          "label": "Preview 900",
          "value": "900 x 600"
        },
        {
          "label": "Preview 1800",
          "value": "1800 x 1200"
        }
      ],
      "sortIndex": 2,
      "title": "02"
    },
    {
      "album": "Common",
      "albumSlug": "common",
      "albumTitle": "Common",
      "caption": "Common",
      "captionColor": "727C5C",
      "className": "real-estate-photo",
      "cloudPdfSource": {
        "bytes": 532506,
        "dimensions": {
          "height": 1200,
          "width": 1800
        },
        "imageUrl": "previews/common/corine-common-0006-d5h-3433_1800.jpg",
        "maxEdge": 1800,
        "mediaType": "photo",
        "publicKey": "RE/Corine/previews/common/corine-common-0006-d5h-3433_1800.jpg",
        "title": "03"
      },
      "displayVariant": "original",
      "editableTitle": "03",
      "full": "0006-D5H_3433.jpg",
      "gallerySrc": "previews/common/corine-common-0006-d5h-3433_900.jpg",
      "id": "corine-common-0006-d5h-3433",
      "imageSrc": "previews/common/corine-common-0006-d5h-3433_1800.jpg",
      "media": {
        "publicPreview": {
          "allowed": true,
          "detailDimensions": {
            "height": 1200,
            "width": 1800
          },
          "detailKey": "RE/Corine/previews/common/corine-common-0006-d5h-3433_1800.jpg",
          "detailUrl": "previews/common/corine-common-0006-d5h-3433_1800.jpg",
          "dimensions": {
            "height": 600,
            "width": 900
          },
          "galleryKey": "RE/Corine/previews/common/corine-common-0006-d5h-3433_900.jpg",
          "galleryUrl": "previews/common/corine-common-0006-d5h-3433_900.jpg",
          "previewUrl": "previews/common/corine-common-0006-d5h-3433_1800.jpg",
          "thumbnailUrl": "previews/common/corine-common-0006-d5h-3433_900.jpg"
        },
        "type": "photo"
      },
      "metadata": [
        {
          "label": "Client",
          "value": "Corine"
        },
        {
          "label": "Album",
          "value": "Common"
        },
        {
          "label": "Original file",
          "value": "0006-D5H_3433.jpg"
        },
        {
          "label": "Original size",
          "value": "4176 x 2784"
        },
        {
          "label": "Preview 900",
          "value": "900 x 600"
        },
        {
          "label": "Preview 1800",
          "value": "1800 x 1200"
        }
      ],
      "sortIndex": 3,
      "title": "03"
    },
    {
      "album": "Common",
      "albumSlug": "common",
      "albumTitle": "Common",
      "caption": "Common",
      "captionColor": "6D7861",
      "className": "real-estate-photo",
      "cloudPdfSource": {
        "bytes": 523609,
        "dimensions": {
          "height": 1200,
          "width": 1800
        },
        "imageUrl": "previews/common/corine-common-0008-d5h-3435_1800.jpg",
        "maxEdge": 1800,
        "mediaType": "photo",
        "publicKey": "RE/Corine/previews/common/corine-common-0008-d5h-3435_1800.jpg",
        "title": "04"
      },
      "displayVariant": "original",
      "editableTitle": "04",
      "full": "0008-D5H_3435.jpg",
      "gallerySrc": "previews/common/corine-common-0008-d5h-3435_900.jpg",
      "id": "corine-common-0008-d5h-3435",
      "imageSrc": "previews/common/corine-common-0008-d5h-3435_1800.jpg",
      "media": {
        "publicPreview": {
          "allowed": true,
          "detailDimensions": {
            "height": 1200,
            "width": 1800
          },
          "detailKey": "RE/Corine/previews/common/corine-common-0008-d5h-3435_1800.jpg",
          "detailUrl": "previews/common/corine-common-0008-d5h-3435_1800.jpg",
          "dimensions": {
            "height": 600,
            "width": 900
          },
          "galleryKey": "RE/Corine/previews/common/corine-common-0008-d5h-3435_900.jpg",
          "galleryUrl": "previews/common/corine-common-0008-d5h-3435_900.jpg",
          "previewUrl": "previews/common/corine-common-0008-d5h-3435_1800.jpg",
          "thumbnailUrl": "previews/common/corine-common-0008-d5h-3435_900.jpg"
        },
        "type": "photo"
      },
      "metadata": [
        {
          "label": "Client",
          "value": "Corine"
        },
        {
          "label": "Album",
          "value": "Common"
        },
        {
          "label": "Original file",
          "value": "0008-D5H_3435.jpg"
        },
        {
          "label": "Original size",
          "value": "4176 x 2784"
        },
        {
          "label": "Preview 900",
          "value": "900 x 600"
        },
        {
          "label": "Preview 1800",
          "value": "1800 x 1200"
        }
      ],
      "sortIndex": 4,
      "title": "04"
    },
    {
      "album": "Common",
      "albumSlug": "common",
      "albumTitle": "Common",
      "caption": "Common",
      "captionColor": "434A36",
      "className": "real-estate-photo",
      "cloudPdfSource": {
        "bytes": 492023,
        "dimensions": {
          "height": 1200,
          "width": 1800
        },
        "imageUrl": "previews/common/corine-common-0010-d5h-3437_1800.jpg",
        "maxEdge": 1800,
        "mediaType": "photo",
        "publicKey": "RE/Corine/previews/common/corine-common-0010-d5h-3437_1800.jpg",
        "title": "05"
      },
      "displayVariant": "original",
      "editableTitle": "05",
      "full": "0010-D5H_3437.jpg",
      "gallerySrc": "previews/common/corine-common-0010-d5h-3437_900.jpg",
      "id": "corine-common-0010-d5h-3437",
      "imageSrc": "previews/common/corine-common-0010-d5h-3437_1800.jpg",
      "media": {
        "publicPreview": {
          "allowed": true,
          "detailDimensions": {
            "height": 1200,
            "width": 1800
          },
          "detailKey": "RE/Corine/previews/common/corine-common-0010-d5h-3437_1800.jpg",
          "detailUrl": "previews/common/corine-common-0010-d5h-3437_1800.jpg",
          "dimensions": {
            "height": 600,
            "width": 900
          },
          "galleryKey": "RE/Corine/previews/common/corine-common-0010-d5h-3437_900.jpg",
          "galleryUrl": "previews/common/corine-common-0010-d5h-3437_900.jpg",
          "previewUrl": "previews/common/corine-common-0010-d5h-3437_1800.jpg",
          "thumbnailUrl": "previews/common/corine-common-0010-d5h-3437_900.jpg"
        },
        "type": "photo"
      },
      "metadata": [
        {
          "label": "Client",
          "value": "Corine"
        },
        {
          "label": "Album",
          "value": "Common"
        },
        {
          "label": "Original file",
          "value": "0010-D5H_3437.jpg"
        },
        {
          "label": "Original size",
          "value": "4176 x 2784"
        },
        {
          "label": "Preview 900",
          "value": "900 x 600"
        },
        {
          "label": "Preview 1800",
          "value": "1800 x 1200"
        }
      ],
      "sortIndex": 5,
      "title": "05"
    },
    {
      "album": "Common",
      "albumSlug": "common",
      "albumTitle": "Common",
      "caption": "Common",
      "captionColor": "394835",
      "className": "real-estate-photo",
      "cloudPdfSource": {
        "bytes": 479455,
        "dimensions": {
          "height": 1200,
          "width": 1800
        },
        "imageUrl": "previews/common/corine-common-0013-d5h-3440_1800.jpg",
        "maxEdge": 1800,
        "mediaType": "photo",
        "publicKey": "RE/Corine/previews/common/corine-common-0013-d5h-3440_1800.jpg",
        "title": "06"
      },
      "displayVariant": "original",
      "editableTitle": "06",
      "full": "0013-D5H_3440.jpg",
      "gallerySrc": "previews/common/corine-common-0013-d5h-3440_900.jpg",
      "id": "corine-common-0013-d5h-3440",
      "imageSrc": "previews/common/corine-common-0013-d5h-3440_1800.jpg",
      "media": {
        "publicPreview": {
          "allowed": true,
          "detailDimensions": {
            "height": 1200,
            "width": 1800
          },
          "detailKey": "RE/Corine/previews/common/corine-common-0013-d5h-3440_1800.jpg",
          "detailUrl": "previews/common/corine-common-0013-d5h-3440_1800.jpg",
          "dimensions": {
            "height": 600,
            "width": 900
          },
          "galleryKey": "RE/Corine/previews/common/corine-common-0013-d5h-3440_900.jpg",
          "galleryUrl": "previews/common/corine-common-0013-d5h-3440_900.jpg",
          "previewUrl": "previews/common/corine-common-0013-d5h-3440_1800.jpg",
          "thumbnailUrl": "previews/common/corine-common-0013-d5h-3440_900.jpg"
        },
        "type": "photo"
      },
      "metadata": [
        {
          "label": "Client",
          "value": "Corine"
        },
        {
          "label": "Album",
          "value": "Common"
        },
        {
          "label": "Original file",
          "value": "0013-D5H_3440.jpg"
        },
        {
          "label": "Original size",
          "value": "4176 x 2784"
        },
        {
          "label": "Preview 900",
          "value": "900 x 600"
        },
        {
          "label": "Preview 1800",
          "value": "1800 x 1200"
        }
      ],
      "sortIndex": 6,
      "title": "06"
    },
    {
      "album": "Common",
      "albumSlug": "common",
      "albumTitle": "Common",
      "caption": "Common",
      "captionColor": "6C6F6B",
      "className": "real-estate-photo",
      "cloudPdfSource": {
        "bytes": 396937,
        "dimensions": {
          "height": 1200,
          "width": 1800
        },
        "imageUrl": "previews/common/corine-common-0015-d5h-3442_1800.jpg",
        "maxEdge": 1800,
        "mediaType": "photo",
        "publicKey": "RE/Corine/previews/common/corine-common-0015-d5h-3442_1800.jpg",
        "title": "07"
      },
      "displayVariant": "original",
      "editableTitle": "07",
      "full": "0015-D5H_3442.jpg",
      "gallerySrc": "previews/common/corine-common-0015-d5h-3442_900.jpg",
      "id": "corine-common-0015-d5h-3442",
      "imageSrc": "previews/common/corine-common-0015-d5h-3442_1800.jpg",
      "media": {
        "publicPreview": {
          "allowed": true,
          "detailDimensions": {
            "height": 1200,
            "width": 1800
          },
          "detailKey": "RE/Corine/previews/common/corine-common-0015-d5h-3442_1800.jpg",
          "detailUrl": "previews/common/corine-common-0015-d5h-3442_1800.jpg",
          "dimensions": {
            "height": 600,
            "width": 900
          },
          "galleryKey": "RE/Corine/previews/common/corine-common-0015-d5h-3442_900.jpg",
          "galleryUrl": "previews/common/corine-common-0015-d5h-3442_900.jpg",
          "previewUrl": "previews/common/corine-common-0015-d5h-3442_1800.jpg",
          "thumbnailUrl": "previews/common/corine-common-0015-d5h-3442_900.jpg"
        },
        "type": "photo"
      },
      "metadata": [
        {
          "label": "Client",
          "value": "Corine"
        },
        {
          "label": "Album",
          "value": "Common"
        },
        {
          "label": "Original file",
          "value": "0015-D5H_3442.jpg"
        },
        {
          "label": "Original size",
          "value": "4176 x 2784"
        },
        {
          "label": "Preview 900",
          "value": "900 x 600"
        },
        {
          "label": "Preview 1800",
          "value": "1800 x 1200"
        }
      ],
      "sortIndex": 7,
      "title": "07"
    },
    {
      "album": "Common",
      "albumSlug": "common",
      "albumTitle": "Common",
      "caption": "Common",
      "captionColor": "56585A",
      "className": "real-estate-photo",
      "cloudPdfSource": {
        "bytes": 492968,
        "dimensions": {
          "height": 1200,
          "width": 1800
        },
        "imageUrl": "previews/common/corine-common-0017-d5h-3444_1800.jpg",
        "maxEdge": 1800,
        "mediaType": "photo",
        "publicKey": "RE/Corine/previews/common/corine-common-0017-d5h-3444_1800.jpg",
        "title": "08"
      },
      "displayVariant": "original",
      "editableTitle": "08",
      "full": "0017-D5H_3444.jpg",
      "gallerySrc": "previews/common/corine-common-0017-d5h-3444_900.jpg",
      "id": "corine-common-0017-d5h-3444",
      "imageSrc": "previews/common/corine-common-0017-d5h-3444_1800.jpg",
      "media": {
        "publicPreview": {
          "allowed": true,
          "detailDimensions": {
            "height": 1200,
            "width": 1800
          },
          "detailKey": "RE/Corine/previews/common/corine-common-0017-d5h-3444_1800.jpg",
          "detailUrl": "previews/common/corine-common-0017-d5h-3444_1800.jpg",
          "dimensions": {
            "height": 600,
            "width": 900
          },
          "galleryKey": "RE/Corine/previews/common/corine-common-0017-d5h-3444_900.jpg",
          "galleryUrl": "previews/common/corine-common-0017-d5h-3444_900.jpg",
          "previewUrl": "previews/common/corine-common-0017-d5h-3444_1800.jpg",
          "thumbnailUrl": "previews/common/corine-common-0017-d5h-3444_900.jpg"
        },
        "type": "photo"
      },
      "metadata": [
        {
          "label": "Client",
          "value": "Corine"
        },
        {
          "label": "Album",
          "value": "Common"
        },
        {
          "label": "Original file",
          "value": "0017-D5H_3444.jpg"
        },
        {
          "label": "Original size",
          "value": "4176 x 2784"
        },
        {
          "label": "Preview 900",
          "value": "900 x 600"
        },
        {
          "label": "Preview 1800",
          "value": "1800 x 1200"
        }
      ],
      "sortIndex": 8,
      "title": "08"
    },
    {
      "album": "Common",
      "albumSlug": "common",
      "albumTitle": "Common",
      "caption": "Common",
      "captionColor": "5A5E61",
      "className": "real-estate-photo",
      "cloudPdfSource": {
        "bytes": 490342,
        "dimensions": {
          "height": 1200,
          "width": 1800
        },
        "imageUrl": "previews/common/corine-common-0019-d5h-3446_1800.jpg",
        "maxEdge": 1800,
        "mediaType": "photo",
        "publicKey": "RE/Corine/previews/common/corine-common-0019-d5h-3446_1800.jpg",
        "title": "09"
      },
      "displayVariant": "original",
      "editableTitle": "09",
      "full": "0019-D5H_3446.jpg",
      "gallerySrc": "previews/common/corine-common-0019-d5h-3446_900.jpg",
      "id": "corine-common-0019-d5h-3446",
      "imageSrc": "previews/common/corine-common-0019-d5h-3446_1800.jpg",
      "media": {
        "publicPreview": {
          "allowed": true,
          "detailDimensions": {
            "height": 1200,
            "width": 1800
          },
          "detailKey": "RE/Corine/previews/common/corine-common-0019-d5h-3446_1800.jpg",
          "detailUrl": "previews/common/corine-common-0019-d5h-3446_1800.jpg",
          "dimensions": {
            "height": 600,
            "width": 900
          },
          "galleryKey": "RE/Corine/previews/common/corine-common-0019-d5h-3446_900.jpg",
          "galleryUrl": "previews/common/corine-common-0019-d5h-3446_900.jpg",
          "previewUrl": "previews/common/corine-common-0019-d5h-3446_1800.jpg",
          "thumbnailUrl": "previews/common/corine-common-0019-d5h-3446_900.jpg"
        },
        "type": "photo"
      },
      "metadata": [
        {
          "label": "Client",
          "value": "Corine"
        },
        {
          "label": "Album",
          "value": "Common"
        },
        {
          "label": "Original file",
          "value": "0019-D5H_3446.jpg"
        },
        {
          "label": "Original size",
          "value": "4176 x 2784"
        },
        {
          "label": "Preview 900",
          "value": "900 x 600"
        },
        {
          "label": "Preview 1800",
          "value": "1800 x 1200"
        }
      ],
      "sortIndex": 9,
      "title": "09"
    },
    {
      "album": "Common",
      "albumSlug": "common",
      "albumTitle": "Common",
      "caption": "Common",
      "captionColor": "6F6157",
      "className": "real-estate-photo",
      "cloudPdfSource": {
        "bytes": 282411,
        "dimensions": {
          "height": 1200,
          "width": 1800
        },
        "imageUrl": "previews/common/corine-common-0021-d5h-3448_1800.jpg",
        "maxEdge": 1800,
        "mediaType": "photo",
        "publicKey": "RE/Corine/previews/common/corine-common-0021-d5h-3448_1800.jpg",
        "title": "10"
      },
      "displayVariant": "original",
      "editableTitle": "10",
      "full": "0021-D5H_3448.jpg",
      "gallerySrc": "previews/common/corine-common-0021-d5h-3448_900.jpg",
      "id": "corine-common-0021-d5h-3448",
      "imageSrc": "previews/common/corine-common-0021-d5h-3448_1800.jpg",
      "media": {
        "publicPreview": {
          "allowed": true,
          "detailDimensions": {
            "height": 1200,
            "width": 1800
          },
          "detailKey": "RE/Corine/previews/common/corine-common-0021-d5h-3448_1800.jpg",
          "detailUrl": "previews/common/corine-common-0021-d5h-3448_1800.jpg",
          "dimensions": {
            "height": 600,
            "width": 900
          },
          "galleryKey": "RE/Corine/previews/common/corine-common-0021-d5h-3448_900.jpg",
          "galleryUrl": "previews/common/corine-common-0021-d5h-3448_900.jpg",
          "previewUrl": "previews/common/corine-common-0021-d5h-3448_1800.jpg",
          "thumbnailUrl": "previews/common/corine-common-0021-d5h-3448_900.jpg"
        },
        "type": "photo"
      },
      "metadata": [
        {
          "label": "Client",
          "value": "Corine"
        },
        {
          "label": "Album",
          "value": "Common"
        },
        {
          "label": "Original file",
          "value": "0021-D5H_3448.jpg"
        },
        {
          "label": "Original size",
          "value": "4176 x 2784"
        },
        {
          "label": "Preview 900",
          "value": "900 x 600"
        },
        {
          "label": "Preview 1800",
          "value": "1800 x 1200"
        }
      ],
      "sortIndex": 10,
      "title": "10"
    },
    {
      "album": "Common",
      "albumSlug": "common",
      "albumTitle": "Common",
      "caption": "Common",
      "captionColor": "8C7C76",
      "className": "real-estate-photo",
      "cloudPdfSource": {
        "bytes": 316231,
        "dimensions": {
          "height": 1800,
          "width": 1200
        },
        "imageUrl": "previews/common/corine-common-0023-d5h-3450_1800.jpg",
        "maxEdge": 1800,
        "mediaType": "photo",
        "publicKey": "RE/Corine/previews/common/corine-common-0023-d5h-3450_1800.jpg",
        "title": "11"
      },
      "displayVariant": "original",
      "editableTitle": "11",
      "full": "0023-D5H_3450.jpg",
      "gallerySrc": "previews/common/corine-common-0023-d5h-3450_900.jpg",
      "id": "corine-common-0023-d5h-3450",
      "imageSrc": "previews/common/corine-common-0023-d5h-3450_1800.jpg",
      "media": {
        "publicPreview": {
          "allowed": true,
          "detailDimensions": {
            "height": 1800,
            "width": 1200
          },
          "detailKey": "RE/Corine/previews/common/corine-common-0023-d5h-3450_1800.jpg",
          "detailUrl": "previews/common/corine-common-0023-d5h-3450_1800.jpg",
          "dimensions": {
            "height": 900,
            "width": 600
          },
          "galleryKey": "RE/Corine/previews/common/corine-common-0023-d5h-3450_900.jpg",
          "galleryUrl": "previews/common/corine-common-0023-d5h-3450_900.jpg",
          "previewUrl": "previews/common/corine-common-0023-d5h-3450_1800.jpg",
          "thumbnailUrl": "previews/common/corine-common-0023-d5h-3450_900.jpg"
        },
        "type": "photo"
      },
      "metadata": [
        {
          "label": "Client",
          "value": "Corine"
        },
        {
          "label": "Album",
          "value": "Common"
        },
        {
          "label": "Original file",
          "value": "0023-D5H_3450.jpg"
        },
        {
          "label": "Original size",
          "value": "2784 x 4176"
        },
        {
          "label": "Preview 900",
          "value": "600 x 900"
        },
        {
          "label": "Preview 1800",
          "value": "1200 x 1800"
        }
      ],
      "sortIndex": 11,
      "title": "11"
    },
    {
      "album": "Common",
      "albumSlug": "common",
      "albumTitle": "Common",
      "caption": "Common",
      "captionColor": "746F6E",
      "className": "real-estate-photo",
      "cloudPdfSource": {
        "bytes": 377613,
        "dimensions": {
          "height": 1200,
          "width": 1800
        },
        "imageUrl": "previews/common/corine-common-0025-d5h-3452_1800.jpg",
        "maxEdge": 1800,
        "mediaType": "photo",
        "publicKey": "RE/Corine/previews/common/corine-common-0025-d5h-3452_1800.jpg",
        "title": "12"
      },
      "displayVariant": "original",
      "editableTitle": "12",
      "full": "0025-D5H_3452.jpg",
      "gallerySrc": "previews/common/corine-common-0025-d5h-3452_900.jpg",
      "id": "corine-common-0025-d5h-3452",
      "imageSrc": "previews/common/corine-common-0025-d5h-3452_1800.jpg",
      "media": {
        "publicPreview": {
          "allowed": true,
          "detailDimensions": {
            "height": 1200,
            "width": 1800
          },
          "detailKey": "RE/Corine/previews/common/corine-common-0025-d5h-3452_1800.jpg",
          "detailUrl": "previews/common/corine-common-0025-d5h-3452_1800.jpg",
          "dimensions": {
            "height": 600,
            "width": 900
          },
          "galleryKey": "RE/Corine/previews/common/corine-common-0025-d5h-3452_900.jpg",
          "galleryUrl": "previews/common/corine-common-0025-d5h-3452_900.jpg",
          "previewUrl": "previews/common/corine-common-0025-d5h-3452_1800.jpg",
          "thumbnailUrl": "previews/common/corine-common-0025-d5h-3452_900.jpg"
        },
        "type": "photo"
      },
      "metadata": [
        {
          "label": "Client",
          "value": "Corine"
        },
        {
          "label": "Album",
          "value": "Common"
        },
        {
          "label": "Original file",
          "value": "0025-D5H_3452.jpg"
        },
        {
          "label": "Original size",
          "value": "4176 x 2784"
        },
        {
          "label": "Preview 900",
          "value": "900 x 600"
        },
        {
          "label": "Preview 1800",
          "value": "1800 x 1200"
        }
      ],
      "sortIndex": 12,
      "title": "12"
    },
    {
      "album": "Common",
      "albumSlug": "common",
      "albumTitle": "Common",
      "caption": "Common",
      "captionColor": "584E42",
      "className": "real-estate-photo",
      "cloudPdfSource": {
        "bytes": 306641,
        "dimensions": {
          "height": 1200,
          "width": 1800
        },
        "imageUrl": "previews/common/corine-common-0027-d5h-3454_1800.jpg",
        "maxEdge": 1800,
        "mediaType": "photo",
        "publicKey": "RE/Corine/previews/common/corine-common-0027-d5h-3454_1800.jpg",
        "title": "13"
      },
      "displayVariant": "original",
      "editableTitle": "13",
      "full": "0027-D5H_3454.jpg",
      "gallerySrc": "previews/common/corine-common-0027-d5h-3454_900.jpg",
      "id": "corine-common-0027-d5h-3454",
      "imageSrc": "previews/common/corine-common-0027-d5h-3454_1800.jpg",
      "media": {
        "publicPreview": {
          "allowed": true,
          "detailDimensions": {
            "height": 1200,
            "width": 1800
          },
          "detailKey": "RE/Corine/previews/common/corine-common-0027-d5h-3454_1800.jpg",
          "detailUrl": "previews/common/corine-common-0027-d5h-3454_1800.jpg",
          "dimensions": {
            "height": 600,
            "width": 900
          },
          "galleryKey": "RE/Corine/previews/common/corine-common-0027-d5h-3454_900.jpg",
          "galleryUrl": "previews/common/corine-common-0027-d5h-3454_900.jpg",
          "previewUrl": "previews/common/corine-common-0027-d5h-3454_1800.jpg",
          "thumbnailUrl": "previews/common/corine-common-0027-d5h-3454_900.jpg"
        },
        "type": "photo"
      },
      "metadata": [
        {
          "label": "Client",
          "value": "Corine"
        },
        {
          "label": "Album",
          "value": "Common"
        },
        {
          "label": "Original file",
          "value": "0027-D5H_3454.jpg"
        },
        {
          "label": "Original size",
          "value": "4176 x 2784"
        },
        {
          "label": "Preview 900",
          "value": "900 x 600"
        },
        {
          "label": "Preview 1800",
          "value": "1800 x 1200"
        }
      ],
      "sortIndex": 13,
      "title": "13"
    },
    {
      "album": "Common",
      "albumSlug": "common",
      "albumTitle": "Common",
      "caption": "Common",
      "captionColor": "32271C",
      "className": "real-estate-photo",
      "cloudPdfSource": {
        "bytes": 409173,
        "dimensions": {
          "height": 1200,
          "width": 1800
        },
        "imageUrl": "previews/common/corine-common-0030-d5h-3457_1800.jpg",
        "maxEdge": 1800,
        "mediaType": "photo",
        "publicKey": "RE/Corine/previews/common/corine-common-0030-d5h-3457_1800.jpg",
        "title": "14"
      },
      "displayVariant": "original",
      "editableTitle": "14",
      "full": "0030-D5H_3457.jpg",
      "gallerySrc": "previews/common/corine-common-0030-d5h-3457_900.jpg",
      "id": "corine-common-0030-d5h-3457",
      "imageSrc": "previews/common/corine-common-0030-d5h-3457_1800.jpg",
      "media": {
        "publicPreview": {
          "allowed": true,
          "detailDimensions": {
            "height": 1200,
            "width": 1800
          },
          "detailKey": "RE/Corine/previews/common/corine-common-0030-d5h-3457_1800.jpg",
          "detailUrl": "previews/common/corine-common-0030-d5h-3457_1800.jpg",
          "dimensions": {
            "height": 600,
            "width": 900
          },
          "galleryKey": "RE/Corine/previews/common/corine-common-0030-d5h-3457_900.jpg",
          "galleryUrl": "previews/common/corine-common-0030-d5h-3457_900.jpg",
          "previewUrl": "previews/common/corine-common-0030-d5h-3457_1800.jpg",
          "thumbnailUrl": "previews/common/corine-common-0030-d5h-3457_900.jpg"
        },
        "type": "photo"
      },
      "metadata": [
        {
          "label": "Client",
          "value": "Corine"
        },
        {
          "label": "Album",
          "value": "Common"
        },
        {
          "label": "Original file",
          "value": "0030-D5H_3457.jpg"
        },
        {
          "label": "Original size",
          "value": "4176 x 2784"
        },
        {
          "label": "Preview 900",
          "value": "900 x 600"
        },
        {
          "label": "Preview 1800",
          "value": "1800 x 1200"
        }
      ],
      "sortIndex": 14,
      "title": "14"
    },
    {
      "album": "Showcase",
      "albumSlug": "showcase",
      "albumTitle": "Showcase",
      "caption": "Showcase",
      "captionColor": "958E8B",
      "className": "real-estate-photo",
      "cloudPdfSource": {
        "bytes": 205467,
        "dimensions": {
          "height": 1023,
          "width": 1537
        },
        "imageUrl": "previews/showcase/corine-showcase-d5h-2976_1800.jpg",
        "maxEdge": 1800,
        "mediaType": "photo",
        "publicKey": "RE/Corine/previews/showcase/corine-showcase-d5h-2976_1800.jpg",
        "title": "01"
      },
      "displayVariant": "approved-rework",
      "editableTitle": "01",
      "full": "D5H_2976.jpg",
      "gallerySrc": "previews/showcase/corine-showcase-d5h-2976_900.jpg",
      "id": "corine-showcase-d5h-2976",
      "imageSrc": "previews/showcase/corine-showcase-d5h-2976_1800.jpg",
      "media": {
        "publicPreview": {
          "allowed": true,
          "detailDimensions": {
            "height": 1023,
            "width": 1537
          },
          "detailKey": "RE/Corine/previews/showcase/corine-showcase-d5h-2976_1800.jpg",
          "detailUrl": "previews/showcase/corine-showcase-d5h-2976_1800.jpg",
          "dimensions": {
            "height": 599,
            "width": 900
          },
          "galleryKey": "RE/Corine/previews/showcase/corine-showcase-d5h-2976_900.jpg",
          "galleryUrl": "previews/showcase/corine-showcase-d5h-2976_900.jpg",
          "previewUrl": "previews/showcase/corine-showcase-d5h-2976_1800.jpg",
          "thumbnailUrl": "previews/showcase/corine-showcase-d5h-2976_900.jpg"
        },
        "type": "photo"
      },
      "metadata": [
        {
          "label": "Client",
          "value": "Corine"
        },
        {
          "label": "Album",
          "value": "Showcase"
        },
        {
          "label": "Original file",
          "value": "D5H_2976.jpg"
        },
        {
          "label": "Original size",
          "value": "1800 x 1200"
        },
        {
          "label": "Preview 900",
          "value": "900 x 599"
        },
        {
          "label": "Preview 1800",
          "value": "1537 x 1023"
        }
      ],
      "sortIndex": 15,
      "title": "01"
    },
    {
      "album": "Showcase",
      "albumSlug": "showcase",
      "albumTitle": "Showcase",
      "caption": "Showcase",
      "captionColor": "AE9E90",
      "className": "real-estate-photo",
      "cloudPdfSource": {
        "bytes": 276143,
        "dimensions": {
          "height": 1024,
          "width": 1536
        },
        "imageUrl": "previews/showcase/corine-showcase-d5h-2985_1800.jpg",
        "maxEdge": 1800,
        "mediaType": "photo",
        "publicKey": "RE/Corine/previews/showcase/corine-showcase-d5h-2985_1800.jpg",
        "title": "02"
      },
      "displayVariant": "approved-rework",
      "editableTitle": "02",
      "full": "D5H_2985.jpg",
      "gallerySrc": "previews/showcase/corine-showcase-d5h-2985_900.jpg",
      "id": "corine-showcase-d5h-2985",
      "imageSrc": "previews/showcase/corine-showcase-d5h-2985_1800.jpg",
      "media": {
        "publicPreview": {
          "allowed": true,
          "detailDimensions": {
            "height": 1024,
            "width": 1536
          },
          "detailKey": "RE/Corine/previews/showcase/corine-showcase-d5h-2985_1800.jpg",
          "detailUrl": "previews/showcase/corine-showcase-d5h-2985_1800.jpg",
          "dimensions": {
            "height": 600,
            "width": 900
          },
          "galleryKey": "RE/Corine/previews/showcase/corine-showcase-d5h-2985_900.jpg",
          "galleryUrl": "previews/showcase/corine-showcase-d5h-2985_900.jpg",
          "previewUrl": "previews/showcase/corine-showcase-d5h-2985_1800.jpg",
          "thumbnailUrl": "previews/showcase/corine-showcase-d5h-2985_900.jpg"
        },
        "type": "photo"
      },
      "metadata": [
        {
          "label": "Client",
          "value": "Corine"
        },
        {
          "label": "Album",
          "value": "Showcase"
        },
        {
          "label": "Original file",
          "value": "D5H_2985.jpg"
        },
        {
          "label": "Original size",
          "value": "1800 x 1200"
        },
        {
          "label": "Preview 900",
          "value": "900 x 600"
        },
        {
          "label": "Preview 1800",
          "value": "1536 x 1024"
        }
      ],
      "sortIndex": 16,
      "title": "02"
    },
    {
      "album": "Showcase",
      "albumSlug": "showcase",
      "albumTitle": "Showcase",
      "caption": "Showcase",
      "captionColor": "A3A9BC",
      "className": "real-estate-photo",
      "cloudPdfSource": {
        "bytes": 263672,
        "dimensions": {
          "height": 1024,
          "width": 1536
        },
        "imageUrl": "previews/showcase/corine-showcase-d5h-3008_1800.jpg",
        "maxEdge": 1800,
        "mediaType": "photo",
        "publicKey": "RE/Corine/previews/showcase/corine-showcase-d5h-3008_1800.jpg",
        "title": "03"
      },
      "displayVariant": "approved-rework",
      "editableTitle": "03",
      "full": "D5H_3008.jpg",
      "gallerySrc": "previews/showcase/corine-showcase-d5h-3008_900.jpg",
      "id": "corine-showcase-d5h-3008",
      "imageSrc": "previews/showcase/corine-showcase-d5h-3008_1800.jpg",
      "media": {
        "publicPreview": {
          "allowed": true,
          "detailDimensions": {
            "height": 1024,
            "width": 1536
          },
          "detailKey": "RE/Corine/previews/showcase/corine-showcase-d5h-3008_1800.jpg",
          "detailUrl": "previews/showcase/corine-showcase-d5h-3008_1800.jpg",
          "dimensions": {
            "height": 600,
            "width": 900
          },
          "galleryKey": "RE/Corine/previews/showcase/corine-showcase-d5h-3008_900.jpg",
          "galleryUrl": "previews/showcase/corine-showcase-d5h-3008_900.jpg",
          "previewUrl": "previews/showcase/corine-showcase-d5h-3008_1800.jpg",
          "thumbnailUrl": "previews/showcase/corine-showcase-d5h-3008_900.jpg"
        },
        "type": "photo"
      },
      "metadata": [
        {
          "label": "Client",
          "value": "Corine"
        },
        {
          "label": "Album",
          "value": "Showcase"
        },
        {
          "label": "Original file",
          "value": "D5H_3008.jpg"
        },
        {
          "label": "Original size",
          "value": "1800 x 1200"
        },
        {
          "label": "Preview 900",
          "value": "900 x 600"
        },
        {
          "label": "Preview 1800",
          "value": "1536 x 1024"
        }
      ],
      "sortIndex": 17,
      "title": "03"
    },
    {
      "album": "Showcase",
      "albumSlug": "showcase",
      "albumTitle": "Showcase",
      "caption": "Showcase",
      "captionColor": "696E54",
      "className": "real-estate-photo",
      "cloudPdfSource": {
        "bytes": 475412,
        "dimensions": {
          "height": 1024,
          "width": 1536
        },
        "imageUrl": "previews/showcase/corine-showcase-d5h-3045_1800.jpg",
        "maxEdge": 1800,
        "mediaType": "photo",
        "publicKey": "RE/Corine/previews/showcase/corine-showcase-d5h-3045_1800.jpg",
        "title": "04"
      },
      "displayVariant": "approved-rework",
      "editableTitle": "04",
      "full": "D5H_3045.jpg",
      "gallerySrc": "previews/showcase/corine-showcase-d5h-3045_900.jpg",
      "id": "corine-showcase-d5h-3045",
      "imageSrc": "previews/showcase/corine-showcase-d5h-3045_1800.jpg",
      "media": {
        "publicPreview": {
          "allowed": true,
          "detailDimensions": {
            "height": 1024,
            "width": 1536
          },
          "detailKey": "RE/Corine/previews/showcase/corine-showcase-d5h-3045_1800.jpg",
          "detailUrl": "previews/showcase/corine-showcase-d5h-3045_1800.jpg",
          "dimensions": {
            "height": 600,
            "width": 900
          },
          "galleryKey": "RE/Corine/previews/showcase/corine-showcase-d5h-3045_900.jpg",
          "galleryUrl": "previews/showcase/corine-showcase-d5h-3045_900.jpg",
          "previewUrl": "previews/showcase/corine-showcase-d5h-3045_1800.jpg",
          "thumbnailUrl": "previews/showcase/corine-showcase-d5h-3045_900.jpg"
        },
        "type": "photo"
      },
      "metadata": [
        {
          "label": "Client",
          "value": "Corine"
        },
        {
          "label": "Album",
          "value": "Showcase"
        },
        {
          "label": "Original file",
          "value": "D5H_3045.jpg"
        },
        {
          "label": "Original size",
          "value": "1800 x 1200"
        },
        {
          "label": "Preview 900",
          "value": "900 x 600"
        },
        {
          "label": "Preview 1800",
          "value": "1536 x 1024"
        }
      ],
      "sortIndex": 18,
      "title": "04"
    },
    {
      "album": "Showcase",
      "albumSlug": "showcase",
      "albumTitle": "Showcase",
      "caption": "Showcase",
      "captionColor": "8B7460",
      "className": "real-estate-photo",
      "cloudPdfSource": {
        "bytes": 276655,
        "dimensions": {
          "height": 1024,
          "width": 1536
        },
        "imageUrl": "previews/showcase/corine-showcase-d5h-3078_1800.jpg",
        "maxEdge": 1800,
        "mediaType": "photo",
        "publicKey": "RE/Corine/previews/showcase/corine-showcase-d5h-3078_1800.jpg",
        "title": "05"
      },
      "displayVariant": "approved-rework",
      "editableTitle": "05",
      "full": "D5H_3078.jpg",
      "gallerySrc": "previews/showcase/corine-showcase-d5h-3078_900.jpg",
      "id": "corine-showcase-d5h-3078",
      "imageSrc": "previews/showcase/corine-showcase-d5h-3078_1800.jpg",
      "media": {
        "publicPreview": {
          "allowed": true,
          "detailDimensions": {
            "height": 1024,
            "width": 1536
          },
          "detailKey": "RE/Corine/previews/showcase/corine-showcase-d5h-3078_1800.jpg",
          "detailUrl": "previews/showcase/corine-showcase-d5h-3078_1800.jpg",
          "dimensions": {
            "height": 600,
            "width": 900
          },
          "galleryKey": "RE/Corine/previews/showcase/corine-showcase-d5h-3078_900.jpg",
          "galleryUrl": "previews/showcase/corine-showcase-d5h-3078_900.jpg",
          "previewUrl": "previews/showcase/corine-showcase-d5h-3078_1800.jpg",
          "thumbnailUrl": "previews/showcase/corine-showcase-d5h-3078_900.jpg"
        },
        "type": "photo"
      },
      "metadata": [
        {
          "label": "Client",
          "value": "Corine"
        },
        {
          "label": "Album",
          "value": "Showcase"
        },
        {
          "label": "Original file",
          "value": "D5H_3078.jpg"
        },
        {
          "label": "Original size",
          "value": "1800 x 1200"
        },
        {
          "label": "Preview 900",
          "value": "900 x 600"
        },
        {
          "label": "Preview 1800",
          "value": "1536 x 1024"
        }
      ],
      "sortIndex": 19,
      "title": "05"
    },
    {
      "album": "Showcase",
      "albumSlug": "showcase",
      "albumTitle": "Showcase",
      "caption": "Showcase",
      "captionColor": "A3988E",
      "className": "real-estate-photo",
      "cloudPdfSource": {
        "bytes": 290276,
        "dimensions": {
          "height": 1024,
          "width": 1536
        },
        "imageUrl": "previews/showcase/corine-showcase-d5h-3085_1800.jpg",
        "maxEdge": 1800,
        "mediaType": "photo",
        "publicKey": "RE/Corine/previews/showcase/corine-showcase-d5h-3085_1800.jpg",
        "title": "06"
      },
      "displayVariant": "approved-rework",
      "editableTitle": "06",
      "full": "D5H_3085.jpg",
      "gallerySrc": "previews/showcase/corine-showcase-d5h-3085_900.jpg",
      "id": "corine-showcase-d5h-3085",
      "imageSrc": "previews/showcase/corine-showcase-d5h-3085_1800.jpg",
      "media": {
        "publicPreview": {
          "allowed": true,
          "detailDimensions": {
            "height": 1024,
            "width": 1536
          },
          "detailKey": "RE/Corine/previews/showcase/corine-showcase-d5h-3085_1800.jpg",
          "detailUrl": "previews/showcase/corine-showcase-d5h-3085_1800.jpg",
          "dimensions": {
            "height": 600,
            "width": 900
          },
          "galleryKey": "RE/Corine/previews/showcase/corine-showcase-d5h-3085_900.jpg",
          "galleryUrl": "previews/showcase/corine-showcase-d5h-3085_900.jpg",
          "previewUrl": "previews/showcase/corine-showcase-d5h-3085_1800.jpg",
          "thumbnailUrl": "previews/showcase/corine-showcase-d5h-3085_900.jpg"
        },
        "type": "photo"
      },
      "metadata": [
        {
          "label": "Client",
          "value": "Corine"
        },
        {
          "label": "Album",
          "value": "Showcase"
        },
        {
          "label": "Original file",
          "value": "D5H_3085.jpg"
        },
        {
          "label": "Original size",
          "value": "1800 x 1200"
        },
        {
          "label": "Preview 900",
          "value": "900 x 600"
        },
        {
          "label": "Preview 1800",
          "value": "1536 x 1024"
        }
      ],
      "sortIndex": 20,
      "title": "06"
    },
    {
      "album": "Showcase",
      "albumSlug": "showcase",
      "albumTitle": "Showcase",
      "caption": "Showcase",
      "captionColor": "847365",
      "className": "real-estate-photo",
      "cloudPdfSource": {
        "bytes": 217561,
        "dimensions": {
          "height": 1024,
          "width": 1536
        },
        "imageUrl": "previews/showcase/corine-showcase-d5h-3087_1800.jpg",
        "maxEdge": 1800,
        "mediaType": "photo",
        "publicKey": "RE/Corine/previews/showcase/corine-showcase-d5h-3087_1800.jpg",
        "title": "07"
      },
      "displayVariant": "approved-rework",
      "editableTitle": "07",
      "full": "D5H_3087.jpg",
      "gallerySrc": "previews/showcase/corine-showcase-d5h-3087_900.jpg",
      "id": "corine-showcase-d5h-3087",
      "imageSrc": "previews/showcase/corine-showcase-d5h-3087_1800.jpg",
      "media": {
        "publicPreview": {
          "allowed": true,
          "detailDimensions": {
            "height": 1024,
            "width": 1536
          },
          "detailKey": "RE/Corine/previews/showcase/corine-showcase-d5h-3087_1800.jpg",
          "detailUrl": "previews/showcase/corine-showcase-d5h-3087_1800.jpg",
          "dimensions": {
            "height": 600,
            "width": 900
          },
          "galleryKey": "RE/Corine/previews/showcase/corine-showcase-d5h-3087_900.jpg",
          "galleryUrl": "previews/showcase/corine-showcase-d5h-3087_900.jpg",
          "previewUrl": "previews/showcase/corine-showcase-d5h-3087_1800.jpg",
          "thumbnailUrl": "previews/showcase/corine-showcase-d5h-3087_900.jpg"
        },
        "type": "photo"
      },
      "metadata": [
        {
          "label": "Client",
          "value": "Corine"
        },
        {
          "label": "Album",
          "value": "Showcase"
        },
        {
          "label": "Original file",
          "value": "D5H_3087.jpg"
        },
        {
          "label": "Original size",
          "value": "1800 x 1200"
        },
        {
          "label": "Preview 900",
          "value": "900 x 600"
        },
        {
          "label": "Preview 1800",
          "value": "1536 x 1024"
        }
      ],
      "sortIndex": 21,
      "title": "07"
    },
    {
      "album": "Showcase",
      "albumSlug": "showcase",
      "albumTitle": "Showcase",
      "caption": "Showcase",
      "captionColor": "9B948C",
      "className": "real-estate-photo",
      "cloudPdfSource": {
        "bytes": 95174,
        "dimensions": {
          "height": 423,
          "width": 1182
        },
        "imageUrl": "previews/showcase/corine-showcase-corine-sea-view-panorama_1800.jpg",
        "maxEdge": 1800,
        "mediaType": "photo",
        "publicKey": "RE/Corine/previews/showcase/corine-showcase-corine-sea-view-panorama_1800.jpg",
        "title": "08"
      },
      "displayVariant": "original",
      "editableTitle": "08",
      "full": "corine-sea-view-panorama.jpg",
      "gallerySrc": "previews/showcase/corine-showcase-corine-sea-view-panorama_900.jpg",
      "id": "corine-showcase-corine-sea-view-panorama",
      "imageSrc": "previews/showcase/corine-showcase-corine-sea-view-panorama_1800.jpg",
      "media": {
        "publicPreview": {
          "allowed": true,
          "detailDimensions": {
            "height": 423,
            "width": 1182
          },
          "detailKey": "RE/Corine/previews/showcase/corine-showcase-corine-sea-view-panorama_1800.jpg",
          "detailUrl": "previews/showcase/corine-showcase-corine-sea-view-panorama_1800.jpg",
          "dimensions": {
            "height": 322,
            "width": 900
          },
          "galleryKey": "RE/Corine/previews/showcase/corine-showcase-corine-sea-view-panorama_900.jpg",
          "galleryUrl": "previews/showcase/corine-showcase-corine-sea-view-panorama_900.jpg",
          "previewUrl": "previews/showcase/corine-showcase-corine-sea-view-panorama_1800.jpg",
          "thumbnailUrl": "previews/showcase/corine-showcase-corine-sea-view-panorama_900.jpg"
        },
        "type": "photo"
      },
      "metadata": [
        {
          "label": "Client",
          "value": "Corine"
        },
        {
          "label": "Album",
          "value": "Showcase"
        },
        {
          "label": "Original file",
          "value": "corine-sea-view-panorama.jpg"
        },
        {
          "label": "Original size",
          "value": "1182 x 423"
        },
        {
          "label": "Preview 900",
          "value": "900 x 322"
        },
        {
          "label": "Preview 1800",
          "value": "1182 x 423"
        }
      ],
      "sortIndex": 22,
      "title": "08"
    }
  ],
  "r2": {
    "publicBucket": "photosbyelie-public",
    "publicPreviewPrefix": "RE/Corine/previews"
  },
  "schema": "photosbyelie.realEstateImport.v1",
  "stats": {
    "albumCount": 2,
    "imageCount": 22,
    "photoCount": 22,
    "preview1800Bytes": 8085318,
    "preview1800MaxEdge": 1800,
    "preview1800Rendered": 22,
    "preview900Bytes": 2263183,
    "preview900MaxEdge": 900,
    "preview900Rendered": 22,
    "sourceBytes": 47852279,
    "videoCount": 0
  }
};
  const script = document.currentScript;
  const base = script?.src ? new URL("./", script.src) : new URL("./", window.location.href);
  const absoluteUrl = (value) => {
    if (!value || /^(https?:|data:|blob:|\/)/i.test(value)) return value || "";
    return new URL(value, base).href;
  };
  const photos = (payload.photos || []).map((photo) => {
    const publicPreview = photo.media?.publicPreview || {};
    const pdfSource = photo.cloudPdfSource || {};
    return {
      ...photo,
      media: {
        ...(photo.media || {}),
        publicPreview: {
          ...publicPreview,
          galleryUrl: absoluteUrl(publicPreview.galleryUrl || photo.gallerySrc),
          detailUrl: absoluteUrl(publicPreview.detailUrl || photo.imageSrc),
          previewUrl: absoluteUrl(publicPreview.previewUrl || photo.imageSrc),
          thumbnailUrl: absoluteUrl(publicPreview.thumbnailUrl || photo.gallerySrc),
        },
      },
      cloudPdfSource: {
        ...pdfSource,
        imageUrl: absoluteUrl(pdfSource.imageUrl),
      },
    };
  });
  const gallery = {
    ...(payload.gallery || {}),
    photos,
  };
  window.photosByElieRealEstateImport = {
    ...payload,
    gallery,
    photos,
  };
  window.photosByElieRealEstateGalleryKey = gallery.key;
  window.photosByElieData = {
    ...(window.photosByElieData || {}),
    [gallery.key]: gallery,
  };
})();

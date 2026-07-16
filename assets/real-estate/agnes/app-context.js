(() => {
  const payload = {
  "albums": [
    {
      "displayTitle": "Common",
      "photoCount": 14,
      "slug": "common",
      "sortIndex": 1,
      "title": "Common"
    }
  ],
  "cloudPdfWorkflow": {
    "assembly": "Cloud service receives selected media ids grouped by apartment project plus edited titles, then generates one PDF or slideshow per project on demand. Videos keep source duration in slideshow output and use the 10% still frame in PDFs.",
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
        "projectIds"
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
      "storageKeyPattern": "real-estate/pdf-batches/agnes-la-concha-common/{batchId}.json",
      "template": {
        "batchId": "",
        "createdAt": "",
        "customer": "Agnes",
        "galleryKey": "agnes-la-concha-common",
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
        "sourceImportGeneratedAt": "2026-05-20T22:01:39+00:00"
      }
    },
    "cloudImageKeyField": "cloudPdfSource.publicKey",
    "imageField": "cloudPdfSource.imageUrl",
    "largeFileMitigation": "Importer prepares cloud PDF/slideshow source metadata instead of final outputs; final assembly/download belongs to the cloud path so the browser does not build one huge Blob locally.",
    "mode": "one-output-per-project",
    "projectStoreKey": "photosbyelie-real-estate-projects-agnes-la-concha-common",
    "selectionStoreKey": "photosbyelie-real-estate-liked-agnes-la-concha-common",
    "titleField": "editableTitle",
    "titleStoreKey": "photosbyelie-real-estate-titles-agnes-la-concha-common"
  },
  "customer": {
    "email": "",
    "name": "Agnes",
    "username": "Agnes"
  },
  "gallery": {
    "accent": "spain",
    "description": "Private La Concha Common-area selection gallery.",
    "key": "agnes-la-concha-common",
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
          "imageUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0002-d5h-3429_1800.jpg",
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
            "detailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0002-d5h-3429_1800.jpg",
            "dimensions": {
              "height": 600,
              "width": 900
            },
            "galleryKey": "RE/Corine/previews/common/corine-common-0002-d5h-3429_900.jpg",
            "galleryUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0002-d5h-3429_900.jpg",
            "previewUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0002-d5h-3429_1800.jpg",
            "thumbnailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0002-d5h-3429_900.jpg"
          },
          "type": "photo"
        },
        "metadata": [
          {
            "label": "Client",
            "value": "Agnes"
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
        "realEstate": {
          "customer": "Agnes",
          "mediaType": "photo",
          "privateMasterKey": "RE/Corine/masters/common/corine-common-0002-d5h-3429.jpg",
          "publicPreviewKeys": {
            "900": "RE/Corine/previews/common/corine-common-0002-d5h-3429_900.jpg",
            "1800": "RE/Corine/previews/common/corine-common-0002-d5h-3429_1800.jpg"
          },
          "sourceBytes": 3500558,
          "sourceDimensions": {
            "height": 2784,
            "width": 4176
          }
        },
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
          "imageUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0004-d5h-3431_1800.jpg",
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
            "detailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0004-d5h-3431_1800.jpg",
            "dimensions": {
              "height": 600,
              "width": 900
            },
            "galleryKey": "RE/Corine/previews/common/corine-common-0004-d5h-3431_900.jpg",
            "galleryUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0004-d5h-3431_900.jpg",
            "previewUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0004-d5h-3431_1800.jpg",
            "thumbnailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0004-d5h-3431_900.jpg"
          },
          "type": "photo"
        },
        "metadata": [
          {
            "label": "Client",
            "value": "Agnes"
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
        "realEstate": {
          "customer": "Agnes",
          "mediaType": "photo",
          "privateMasterKey": "RE/Corine/masters/common/corine-common-0004-d5h-3431.jpg",
          "publicPreviewKeys": {
            "900": "RE/Corine/previews/common/corine-common-0004-d5h-3431_900.jpg",
            "1800": "RE/Corine/previews/common/corine-common-0004-d5h-3431_1800.jpg"
          },
          "sourceBytes": 3554458,
          "sourceDimensions": {
            "height": 2784,
            "width": 4176
          }
        },
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
          "imageUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0006-d5h-3433_1800.jpg",
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
            "detailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0006-d5h-3433_1800.jpg",
            "dimensions": {
              "height": 600,
              "width": 900
            },
            "galleryKey": "RE/Corine/previews/common/corine-common-0006-d5h-3433_900.jpg",
            "galleryUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0006-d5h-3433_900.jpg",
            "previewUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0006-d5h-3433_1800.jpg",
            "thumbnailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0006-d5h-3433_900.jpg"
          },
          "type": "photo"
        },
        "metadata": [
          {
            "label": "Client",
            "value": "Agnes"
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
        "realEstate": {
          "customer": "Agnes",
          "mediaType": "photo",
          "privateMasterKey": "RE/Corine/masters/common/corine-common-0006-d5h-3433.jpg",
          "publicPreviewKeys": {
            "900": "RE/Corine/previews/common/corine-common-0006-d5h-3433_900.jpg",
            "1800": "RE/Corine/previews/common/corine-common-0006-d5h-3433_1800.jpg"
          },
          "sourceBytes": 3801184,
          "sourceDimensions": {
            "height": 2784,
            "width": 4176
          }
        },
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
          "imageUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0008-d5h-3435_1800.jpg",
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
            "detailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0008-d5h-3435_1800.jpg",
            "dimensions": {
              "height": 600,
              "width": 900
            },
            "galleryKey": "RE/Corine/previews/common/corine-common-0008-d5h-3435_900.jpg",
            "galleryUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0008-d5h-3435_900.jpg",
            "previewUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0008-d5h-3435_1800.jpg",
            "thumbnailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0008-d5h-3435_900.jpg"
          },
          "type": "photo"
        },
        "metadata": [
          {
            "label": "Client",
            "value": "Agnes"
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
        "realEstate": {
          "customer": "Agnes",
          "mediaType": "photo",
          "privateMasterKey": "RE/Corine/masters/common/corine-common-0008-d5h-3435.jpg",
          "publicPreviewKeys": {
            "900": "RE/Corine/previews/common/corine-common-0008-d5h-3435_900.jpg",
            "1800": "RE/Corine/previews/common/corine-common-0008-d5h-3435_1800.jpg"
          },
          "sourceBytes": 3922507,
          "sourceDimensions": {
            "height": 2784,
            "width": 4176
          }
        },
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
          "imageUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0010-d5h-3437_1800.jpg",
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
            "detailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0010-d5h-3437_1800.jpg",
            "dimensions": {
              "height": 600,
              "width": 900
            },
            "galleryKey": "RE/Corine/previews/common/corine-common-0010-d5h-3437_900.jpg",
            "galleryUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0010-d5h-3437_900.jpg",
            "previewUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0010-d5h-3437_1800.jpg",
            "thumbnailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0010-d5h-3437_900.jpg"
          },
          "type": "photo"
        },
        "metadata": [
          {
            "label": "Client",
            "value": "Agnes"
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
        "realEstate": {
          "customer": "Agnes",
          "mediaType": "photo",
          "privateMasterKey": "RE/Corine/masters/common/corine-common-0010-d5h-3437.jpg",
          "publicPreviewKeys": {
            "900": "RE/Corine/previews/common/corine-common-0010-d5h-3437_900.jpg",
            "1800": "RE/Corine/previews/common/corine-common-0010-d5h-3437_1800.jpg"
          },
          "sourceBytes": 3443971,
          "sourceDimensions": {
            "height": 2784,
            "width": 4176
          }
        },
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
          "imageUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0013-d5h-3440_1800.jpg",
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
            "detailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0013-d5h-3440_1800.jpg",
            "dimensions": {
              "height": 600,
              "width": 900
            },
            "galleryKey": "RE/Corine/previews/common/corine-common-0013-d5h-3440_900.jpg",
            "galleryUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0013-d5h-3440_900.jpg",
            "previewUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0013-d5h-3440_1800.jpg",
            "thumbnailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0013-d5h-3440_900.jpg"
          },
          "type": "photo"
        },
        "metadata": [
          {
            "label": "Client",
            "value": "Agnes"
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
        "realEstate": {
          "customer": "Agnes",
          "mediaType": "photo",
          "privateMasterKey": "RE/Corine/masters/common/corine-common-0013-d5h-3440.jpg",
          "publicPreviewKeys": {
            "900": "RE/Corine/previews/common/corine-common-0013-d5h-3440_900.jpg",
            "1800": "RE/Corine/previews/common/corine-common-0013-d5h-3440_1800.jpg"
          },
          "sourceBytes": 3671718,
          "sourceDimensions": {
            "height": 2784,
            "width": 4176
          }
        },
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
          "imageUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0015-d5h-3442_1800.jpg",
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
            "detailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0015-d5h-3442_1800.jpg",
            "dimensions": {
              "height": 600,
              "width": 900
            },
            "galleryKey": "RE/Corine/previews/common/corine-common-0015-d5h-3442_900.jpg",
            "galleryUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0015-d5h-3442_900.jpg",
            "previewUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0015-d5h-3442_1800.jpg",
            "thumbnailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0015-d5h-3442_900.jpg"
          },
          "type": "photo"
        },
        "metadata": [
          {
            "label": "Client",
            "value": "Agnes"
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
        "realEstate": {
          "customer": "Agnes",
          "mediaType": "photo",
          "privateMasterKey": "RE/Corine/masters/common/corine-common-0015-d5h-3442.jpg",
          "publicPreviewKeys": {
            "900": "RE/Corine/previews/common/corine-common-0015-d5h-3442_900.jpg",
            "1800": "RE/Corine/previews/common/corine-common-0015-d5h-3442_1800.jpg"
          },
          "sourceBytes": 2814771,
          "sourceDimensions": {
            "height": 2784,
            "width": 4176
          }
        },
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
          "imageUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0017-d5h-3444_1800.jpg",
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
            "detailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0017-d5h-3444_1800.jpg",
            "dimensions": {
              "height": 600,
              "width": 900
            },
            "galleryKey": "RE/Corine/previews/common/corine-common-0017-d5h-3444_900.jpg",
            "galleryUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0017-d5h-3444_900.jpg",
            "previewUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0017-d5h-3444_1800.jpg",
            "thumbnailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0017-d5h-3444_900.jpg"
          },
          "type": "photo"
        },
        "metadata": [
          {
            "label": "Client",
            "value": "Agnes"
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
        "realEstate": {
          "customer": "Agnes",
          "mediaType": "photo",
          "privateMasterKey": "RE/Corine/masters/common/corine-common-0017-d5h-3444.jpg",
          "publicPreviewKeys": {
            "900": "RE/Corine/previews/common/corine-common-0017-d5h-3444_900.jpg",
            "1800": "RE/Corine/previews/common/corine-common-0017-d5h-3444_1800.jpg"
          },
          "sourceBytes": 3316688,
          "sourceDimensions": {
            "height": 2784,
            "width": 4176
          }
        },
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
          "imageUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0019-d5h-3446_1800.jpg",
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
            "detailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0019-d5h-3446_1800.jpg",
            "dimensions": {
              "height": 600,
              "width": 900
            },
            "galleryKey": "RE/Corine/previews/common/corine-common-0019-d5h-3446_900.jpg",
            "galleryUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0019-d5h-3446_900.jpg",
            "previewUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0019-d5h-3446_1800.jpg",
            "thumbnailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0019-d5h-3446_900.jpg"
          },
          "type": "photo"
        },
        "metadata": [
          {
            "label": "Client",
            "value": "Agnes"
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
        "realEstate": {
          "customer": "Agnes",
          "mediaType": "photo",
          "privateMasterKey": "RE/Corine/masters/common/corine-common-0019-d5h-3446.jpg",
          "publicPreviewKeys": {
            "900": "RE/Corine/previews/common/corine-common-0019-d5h-3446_900.jpg",
            "1800": "RE/Corine/previews/common/corine-common-0019-d5h-3446_1800.jpg"
          },
          "sourceBytes": 3229804,
          "sourceDimensions": {
            "height": 2784,
            "width": 4176
          }
        },
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
          "imageUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0021-d5h-3448_1800.jpg",
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
            "detailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0021-d5h-3448_1800.jpg",
            "dimensions": {
              "height": 600,
              "width": 900
            },
            "galleryKey": "RE/Corine/previews/common/corine-common-0021-d5h-3448_900.jpg",
            "galleryUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0021-d5h-3448_900.jpg",
            "previewUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0021-d5h-3448_1800.jpg",
            "thumbnailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0021-d5h-3448_900.jpg"
          },
          "type": "photo"
        },
        "metadata": [
          {
            "label": "Client",
            "value": "Agnes"
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
        "realEstate": {
          "customer": "Agnes",
          "mediaType": "photo",
          "privateMasterKey": "RE/Corine/masters/common/corine-common-0021-d5h-3448.jpg",
          "publicPreviewKeys": {
            "900": "RE/Corine/previews/common/corine-common-0021-d5h-3448_900.jpg",
            "1800": "RE/Corine/previews/common/corine-common-0021-d5h-3448_1800.jpg"
          },
          "sourceBytes": 2177667,
          "sourceDimensions": {
            "height": 2784,
            "width": 4176
          }
        },
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
          "imageUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0023-d5h-3450_1800.jpg",
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
            "detailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0023-d5h-3450_1800.jpg",
            "dimensions": {
              "height": 900,
              "width": 600
            },
            "galleryKey": "RE/Corine/previews/common/corine-common-0023-d5h-3450_900.jpg",
            "galleryUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0023-d5h-3450_900.jpg",
            "previewUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0023-d5h-3450_1800.jpg",
            "thumbnailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0023-d5h-3450_900.jpg"
          },
          "type": "photo"
        },
        "metadata": [
          {
            "label": "Client",
            "value": "Agnes"
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
        "realEstate": {
          "customer": "Agnes",
          "mediaType": "photo",
          "privateMasterKey": "RE/Corine/masters/common/corine-common-0023-d5h-3450.jpg",
          "publicPreviewKeys": {
            "900": "RE/Corine/previews/common/corine-common-0023-d5h-3450_900.jpg",
            "1800": "RE/Corine/previews/common/corine-common-0023-d5h-3450_1800.jpg"
          },
          "sourceBytes": 2386053,
          "sourceDimensions": {
            "height": 4176,
            "width": 2784
          }
        },
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
          "imageUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0025-d5h-3452_1800.jpg",
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
            "detailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0025-d5h-3452_1800.jpg",
            "dimensions": {
              "height": 600,
              "width": 900
            },
            "galleryKey": "RE/Corine/previews/common/corine-common-0025-d5h-3452_900.jpg",
            "galleryUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0025-d5h-3452_900.jpg",
            "previewUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0025-d5h-3452_1800.jpg",
            "thumbnailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0025-d5h-3452_900.jpg"
          },
          "type": "photo"
        },
        "metadata": [
          {
            "label": "Client",
            "value": "Agnes"
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
        "realEstate": {
          "customer": "Agnes",
          "mediaType": "photo",
          "privateMasterKey": "RE/Corine/masters/common/corine-common-0025-d5h-3452.jpg",
          "publicPreviewKeys": {
            "900": "RE/Corine/previews/common/corine-common-0025-d5h-3452_900.jpg",
            "1800": "RE/Corine/previews/common/corine-common-0025-d5h-3452_1800.jpg"
          },
          "sourceBytes": 2649317,
          "sourceDimensions": {
            "height": 2784,
            "width": 4176
          }
        },
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
          "imageUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0027-d5h-3454_1800.jpg",
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
            "detailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0027-d5h-3454_1800.jpg",
            "dimensions": {
              "height": 600,
              "width": 900
            },
            "galleryKey": "RE/Corine/previews/common/corine-common-0027-d5h-3454_900.jpg",
            "galleryUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0027-d5h-3454_900.jpg",
            "previewUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0027-d5h-3454_1800.jpg",
            "thumbnailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0027-d5h-3454_900.jpg"
          },
          "type": "photo"
        },
        "metadata": [
          {
            "label": "Client",
            "value": "Agnes"
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
        "realEstate": {
          "customer": "Agnes",
          "mediaType": "photo",
          "privateMasterKey": "RE/Corine/masters/common/corine-common-0027-d5h-3454.jpg",
          "publicPreviewKeys": {
            "900": "RE/Corine/previews/common/corine-common-0027-d5h-3454_900.jpg",
            "1800": "RE/Corine/previews/common/corine-common-0027-d5h-3454_1800.jpg"
          },
          "sourceBytes": 2239268,
          "sourceDimensions": {
            "height": 2784,
            "width": 4176
          }
        },
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
          "imageUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0030-d5h-3457_1800.jpg",
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
            "detailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0030-d5h-3457_1800.jpg",
            "dimensions": {
              "height": 600,
              "width": 900
            },
            "galleryKey": "RE/Corine/previews/common/corine-common-0030-d5h-3457_900.jpg",
            "galleryUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0030-d5h-3457_900.jpg",
            "previewUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0030-d5h-3457_1800.jpg",
            "thumbnailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0030-d5h-3457_900.jpg"
          },
          "type": "photo"
        },
        "metadata": [
          {
            "label": "Client",
            "value": "Agnes"
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
        "realEstate": {
          "customer": "Agnes",
          "mediaType": "photo",
          "privateMasterKey": "RE/Corine/masters/common/corine-common-0030-d5h-3457.jpg",
          "publicPreviewKeys": {
            "900": "RE/Corine/previews/common/corine-common-0030-d5h-3457_900.jpg",
            "1800": "RE/Corine/previews/common/corine-common-0030-d5h-3457_1800.jpg"
          },
          "sourceBytes": 4144482,
          "sourceDimensions": {
            "height": 2784,
            "width": 4176
          }
        },
        "sortIndex": 14,
        "title": "14"
      }
    ],
    "title": "La Concha / Common"
  },
  "generatedAt": "2026-07-16T16:30:29+00:00",
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
        "imageUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0002-d5h-3429_1800.jpg",
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
          "detailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0002-d5h-3429_1800.jpg",
          "dimensions": {
            "height": 600,
            "width": 900
          },
          "galleryKey": "RE/Corine/previews/common/corine-common-0002-d5h-3429_900.jpg",
          "galleryUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0002-d5h-3429_900.jpg",
          "previewUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0002-d5h-3429_1800.jpg",
          "thumbnailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0002-d5h-3429_900.jpg"
        },
        "type": "photo"
      },
      "metadata": [
        {
          "label": "Client",
          "value": "Agnes"
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
      "realEstate": {
        "customer": "Agnes",
        "mediaType": "photo",
        "privateMasterKey": "RE/Corine/masters/common/corine-common-0002-d5h-3429.jpg",
        "publicPreviewKeys": {
          "900": "RE/Corine/previews/common/corine-common-0002-d5h-3429_900.jpg",
          "1800": "RE/Corine/previews/common/corine-common-0002-d5h-3429_1800.jpg"
        },
        "sourceBytes": 3500558,
        "sourceDimensions": {
          "height": 2784,
          "width": 4176
        }
      },
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
        "imageUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0004-d5h-3431_1800.jpg",
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
          "detailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0004-d5h-3431_1800.jpg",
          "dimensions": {
            "height": 600,
            "width": 900
          },
          "galleryKey": "RE/Corine/previews/common/corine-common-0004-d5h-3431_900.jpg",
          "galleryUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0004-d5h-3431_900.jpg",
          "previewUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0004-d5h-3431_1800.jpg",
          "thumbnailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0004-d5h-3431_900.jpg"
        },
        "type": "photo"
      },
      "metadata": [
        {
          "label": "Client",
          "value": "Agnes"
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
      "realEstate": {
        "customer": "Agnes",
        "mediaType": "photo",
        "privateMasterKey": "RE/Corine/masters/common/corine-common-0004-d5h-3431.jpg",
        "publicPreviewKeys": {
          "900": "RE/Corine/previews/common/corine-common-0004-d5h-3431_900.jpg",
          "1800": "RE/Corine/previews/common/corine-common-0004-d5h-3431_1800.jpg"
        },
        "sourceBytes": 3554458,
        "sourceDimensions": {
          "height": 2784,
          "width": 4176
        }
      },
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
        "imageUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0006-d5h-3433_1800.jpg",
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
          "detailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0006-d5h-3433_1800.jpg",
          "dimensions": {
            "height": 600,
            "width": 900
          },
          "galleryKey": "RE/Corine/previews/common/corine-common-0006-d5h-3433_900.jpg",
          "galleryUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0006-d5h-3433_900.jpg",
          "previewUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0006-d5h-3433_1800.jpg",
          "thumbnailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0006-d5h-3433_900.jpg"
        },
        "type": "photo"
      },
      "metadata": [
        {
          "label": "Client",
          "value": "Agnes"
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
      "realEstate": {
        "customer": "Agnes",
        "mediaType": "photo",
        "privateMasterKey": "RE/Corine/masters/common/corine-common-0006-d5h-3433.jpg",
        "publicPreviewKeys": {
          "900": "RE/Corine/previews/common/corine-common-0006-d5h-3433_900.jpg",
          "1800": "RE/Corine/previews/common/corine-common-0006-d5h-3433_1800.jpg"
        },
        "sourceBytes": 3801184,
        "sourceDimensions": {
          "height": 2784,
          "width": 4176
        }
      },
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
        "imageUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0008-d5h-3435_1800.jpg",
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
          "detailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0008-d5h-3435_1800.jpg",
          "dimensions": {
            "height": 600,
            "width": 900
          },
          "galleryKey": "RE/Corine/previews/common/corine-common-0008-d5h-3435_900.jpg",
          "galleryUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0008-d5h-3435_900.jpg",
          "previewUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0008-d5h-3435_1800.jpg",
          "thumbnailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0008-d5h-3435_900.jpg"
        },
        "type": "photo"
      },
      "metadata": [
        {
          "label": "Client",
          "value": "Agnes"
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
      "realEstate": {
        "customer": "Agnes",
        "mediaType": "photo",
        "privateMasterKey": "RE/Corine/masters/common/corine-common-0008-d5h-3435.jpg",
        "publicPreviewKeys": {
          "900": "RE/Corine/previews/common/corine-common-0008-d5h-3435_900.jpg",
          "1800": "RE/Corine/previews/common/corine-common-0008-d5h-3435_1800.jpg"
        },
        "sourceBytes": 3922507,
        "sourceDimensions": {
          "height": 2784,
          "width": 4176
        }
      },
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
        "imageUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0010-d5h-3437_1800.jpg",
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
          "detailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0010-d5h-3437_1800.jpg",
          "dimensions": {
            "height": 600,
            "width": 900
          },
          "galleryKey": "RE/Corine/previews/common/corine-common-0010-d5h-3437_900.jpg",
          "galleryUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0010-d5h-3437_900.jpg",
          "previewUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0010-d5h-3437_1800.jpg",
          "thumbnailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0010-d5h-3437_900.jpg"
        },
        "type": "photo"
      },
      "metadata": [
        {
          "label": "Client",
          "value": "Agnes"
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
      "realEstate": {
        "customer": "Agnes",
        "mediaType": "photo",
        "privateMasterKey": "RE/Corine/masters/common/corine-common-0010-d5h-3437.jpg",
        "publicPreviewKeys": {
          "900": "RE/Corine/previews/common/corine-common-0010-d5h-3437_900.jpg",
          "1800": "RE/Corine/previews/common/corine-common-0010-d5h-3437_1800.jpg"
        },
        "sourceBytes": 3443971,
        "sourceDimensions": {
          "height": 2784,
          "width": 4176
        }
      },
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
        "imageUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0013-d5h-3440_1800.jpg",
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
          "detailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0013-d5h-3440_1800.jpg",
          "dimensions": {
            "height": 600,
            "width": 900
          },
          "galleryKey": "RE/Corine/previews/common/corine-common-0013-d5h-3440_900.jpg",
          "galleryUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0013-d5h-3440_900.jpg",
          "previewUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0013-d5h-3440_1800.jpg",
          "thumbnailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0013-d5h-3440_900.jpg"
        },
        "type": "photo"
      },
      "metadata": [
        {
          "label": "Client",
          "value": "Agnes"
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
      "realEstate": {
        "customer": "Agnes",
        "mediaType": "photo",
        "privateMasterKey": "RE/Corine/masters/common/corine-common-0013-d5h-3440.jpg",
        "publicPreviewKeys": {
          "900": "RE/Corine/previews/common/corine-common-0013-d5h-3440_900.jpg",
          "1800": "RE/Corine/previews/common/corine-common-0013-d5h-3440_1800.jpg"
        },
        "sourceBytes": 3671718,
        "sourceDimensions": {
          "height": 2784,
          "width": 4176
        }
      },
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
        "imageUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0015-d5h-3442_1800.jpg",
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
          "detailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0015-d5h-3442_1800.jpg",
          "dimensions": {
            "height": 600,
            "width": 900
          },
          "galleryKey": "RE/Corine/previews/common/corine-common-0015-d5h-3442_900.jpg",
          "galleryUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0015-d5h-3442_900.jpg",
          "previewUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0015-d5h-3442_1800.jpg",
          "thumbnailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0015-d5h-3442_900.jpg"
        },
        "type": "photo"
      },
      "metadata": [
        {
          "label": "Client",
          "value": "Agnes"
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
      "realEstate": {
        "customer": "Agnes",
        "mediaType": "photo",
        "privateMasterKey": "RE/Corine/masters/common/corine-common-0015-d5h-3442.jpg",
        "publicPreviewKeys": {
          "900": "RE/Corine/previews/common/corine-common-0015-d5h-3442_900.jpg",
          "1800": "RE/Corine/previews/common/corine-common-0015-d5h-3442_1800.jpg"
        },
        "sourceBytes": 2814771,
        "sourceDimensions": {
          "height": 2784,
          "width": 4176
        }
      },
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
        "imageUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0017-d5h-3444_1800.jpg",
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
          "detailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0017-d5h-3444_1800.jpg",
          "dimensions": {
            "height": 600,
            "width": 900
          },
          "galleryKey": "RE/Corine/previews/common/corine-common-0017-d5h-3444_900.jpg",
          "galleryUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0017-d5h-3444_900.jpg",
          "previewUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0017-d5h-3444_1800.jpg",
          "thumbnailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0017-d5h-3444_900.jpg"
        },
        "type": "photo"
      },
      "metadata": [
        {
          "label": "Client",
          "value": "Agnes"
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
      "realEstate": {
        "customer": "Agnes",
        "mediaType": "photo",
        "privateMasterKey": "RE/Corine/masters/common/corine-common-0017-d5h-3444.jpg",
        "publicPreviewKeys": {
          "900": "RE/Corine/previews/common/corine-common-0017-d5h-3444_900.jpg",
          "1800": "RE/Corine/previews/common/corine-common-0017-d5h-3444_1800.jpg"
        },
        "sourceBytes": 3316688,
        "sourceDimensions": {
          "height": 2784,
          "width": 4176
        }
      },
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
        "imageUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0019-d5h-3446_1800.jpg",
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
          "detailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0019-d5h-3446_1800.jpg",
          "dimensions": {
            "height": 600,
            "width": 900
          },
          "galleryKey": "RE/Corine/previews/common/corine-common-0019-d5h-3446_900.jpg",
          "galleryUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0019-d5h-3446_900.jpg",
          "previewUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0019-d5h-3446_1800.jpg",
          "thumbnailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0019-d5h-3446_900.jpg"
        },
        "type": "photo"
      },
      "metadata": [
        {
          "label": "Client",
          "value": "Agnes"
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
      "realEstate": {
        "customer": "Agnes",
        "mediaType": "photo",
        "privateMasterKey": "RE/Corine/masters/common/corine-common-0019-d5h-3446.jpg",
        "publicPreviewKeys": {
          "900": "RE/Corine/previews/common/corine-common-0019-d5h-3446_900.jpg",
          "1800": "RE/Corine/previews/common/corine-common-0019-d5h-3446_1800.jpg"
        },
        "sourceBytes": 3229804,
        "sourceDimensions": {
          "height": 2784,
          "width": 4176
        }
      },
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
        "imageUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0021-d5h-3448_1800.jpg",
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
          "detailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0021-d5h-3448_1800.jpg",
          "dimensions": {
            "height": 600,
            "width": 900
          },
          "galleryKey": "RE/Corine/previews/common/corine-common-0021-d5h-3448_900.jpg",
          "galleryUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0021-d5h-3448_900.jpg",
          "previewUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0021-d5h-3448_1800.jpg",
          "thumbnailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0021-d5h-3448_900.jpg"
        },
        "type": "photo"
      },
      "metadata": [
        {
          "label": "Client",
          "value": "Agnes"
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
      "realEstate": {
        "customer": "Agnes",
        "mediaType": "photo",
        "privateMasterKey": "RE/Corine/masters/common/corine-common-0021-d5h-3448.jpg",
        "publicPreviewKeys": {
          "900": "RE/Corine/previews/common/corine-common-0021-d5h-3448_900.jpg",
          "1800": "RE/Corine/previews/common/corine-common-0021-d5h-3448_1800.jpg"
        },
        "sourceBytes": 2177667,
        "sourceDimensions": {
          "height": 2784,
          "width": 4176
        }
      },
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
        "imageUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0023-d5h-3450_1800.jpg",
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
          "detailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0023-d5h-3450_1800.jpg",
          "dimensions": {
            "height": 900,
            "width": 600
          },
          "galleryKey": "RE/Corine/previews/common/corine-common-0023-d5h-3450_900.jpg",
          "galleryUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0023-d5h-3450_900.jpg",
          "previewUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0023-d5h-3450_1800.jpg",
          "thumbnailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0023-d5h-3450_900.jpg"
        },
        "type": "photo"
      },
      "metadata": [
        {
          "label": "Client",
          "value": "Agnes"
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
      "realEstate": {
        "customer": "Agnes",
        "mediaType": "photo",
        "privateMasterKey": "RE/Corine/masters/common/corine-common-0023-d5h-3450.jpg",
        "publicPreviewKeys": {
          "900": "RE/Corine/previews/common/corine-common-0023-d5h-3450_900.jpg",
          "1800": "RE/Corine/previews/common/corine-common-0023-d5h-3450_1800.jpg"
        },
        "sourceBytes": 2386053,
        "sourceDimensions": {
          "height": 4176,
          "width": 2784
        }
      },
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
        "imageUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0025-d5h-3452_1800.jpg",
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
          "detailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0025-d5h-3452_1800.jpg",
          "dimensions": {
            "height": 600,
            "width": 900
          },
          "galleryKey": "RE/Corine/previews/common/corine-common-0025-d5h-3452_900.jpg",
          "galleryUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0025-d5h-3452_900.jpg",
          "previewUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0025-d5h-3452_1800.jpg",
          "thumbnailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0025-d5h-3452_900.jpg"
        },
        "type": "photo"
      },
      "metadata": [
        {
          "label": "Client",
          "value": "Agnes"
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
      "realEstate": {
        "customer": "Agnes",
        "mediaType": "photo",
        "privateMasterKey": "RE/Corine/masters/common/corine-common-0025-d5h-3452.jpg",
        "publicPreviewKeys": {
          "900": "RE/Corine/previews/common/corine-common-0025-d5h-3452_900.jpg",
          "1800": "RE/Corine/previews/common/corine-common-0025-d5h-3452_1800.jpg"
        },
        "sourceBytes": 2649317,
        "sourceDimensions": {
          "height": 2784,
          "width": 4176
        }
      },
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
        "imageUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0027-d5h-3454_1800.jpg",
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
          "detailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0027-d5h-3454_1800.jpg",
          "dimensions": {
            "height": 600,
            "width": 900
          },
          "galleryKey": "RE/Corine/previews/common/corine-common-0027-d5h-3454_900.jpg",
          "galleryUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0027-d5h-3454_900.jpg",
          "previewUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0027-d5h-3454_1800.jpg",
          "thumbnailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0027-d5h-3454_900.jpg"
        },
        "type": "photo"
      },
      "metadata": [
        {
          "label": "Client",
          "value": "Agnes"
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
      "realEstate": {
        "customer": "Agnes",
        "mediaType": "photo",
        "privateMasterKey": "RE/Corine/masters/common/corine-common-0027-d5h-3454.jpg",
        "publicPreviewKeys": {
          "900": "RE/Corine/previews/common/corine-common-0027-d5h-3454_900.jpg",
          "1800": "RE/Corine/previews/common/corine-common-0027-d5h-3454_1800.jpg"
        },
        "sourceBytes": 2239268,
        "sourceDimensions": {
          "height": 2784,
          "width": 4176
        }
      },
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
        "imageUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0030-d5h-3457_1800.jpg",
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
          "detailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0030-d5h-3457_1800.jpg",
          "dimensions": {
            "height": 600,
            "width": 900
          },
          "galleryKey": "RE/Corine/previews/common/corine-common-0030-d5h-3457_900.jpg",
          "galleryUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0030-d5h-3457_900.jpg",
          "previewUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0030-d5h-3457_1800.jpg",
          "thumbnailUrl": "file:///Users/ecohen/MDev/PhotosByElie/assets/real-estate/corine/previews/common/corine-common-0030-d5h-3457_900.jpg"
        },
        "type": "photo"
      },
      "metadata": [
        {
          "label": "Client",
          "value": "Agnes"
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
      "realEstate": {
        "customer": "Agnes",
        "mediaType": "photo",
        "privateMasterKey": "RE/Corine/masters/common/corine-common-0030-d5h-3457.jpg",
        "publicPreviewKeys": {
          "900": "RE/Corine/previews/common/corine-common-0030-d5h-3457_900.jpg",
          "1800": "RE/Corine/previews/common/corine-common-0030-d5h-3457_1800.jpg"
        },
        "sourceBytes": 4144482,
        "sourceDimensions": {
          "height": 2784,
          "width": 4176
        }
      },
      "sortIndex": 14,
      "title": "14"
    }
  ],
  "r2": {
    "publicBucket": "photosbyelie-public",
    "publicPreviewPrefix": "RE/Corine/previews"
  },
  "schema": "photosbyelie.realEstateImport.v1",
  "stats": {
    "albumCount": 1,
    "imageCount": 14,
    "photoCount": 14,
    "preview1800Bytes": 40168751,
    "preview1800MaxEdge": 1800,
    "preview1800Rendered": 15,
    "preview900Bytes": 10876449,
    "preview900MaxEdge": 900,
    "preview900Rendered": 15,
    "sourceBytes": 44852446,
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

import Foundation
import OSAKit

public struct PhotoMetadataApplyRequest: Codable, Sendable, Equatable {
    public var assetID: String
    public var title: String
    public var caption: String
    public var keywords: [String]
    public var managedKeywords: [String]

    public init(
        assetID: String,
        title: String = "",
        caption: String = "",
        keywords: [String] = [],
        managedKeywords: [String] = []
    ) {
        self.assetID = assetID
        self.title = title
        self.caption = caption
        self.keywords = keywords
        self.managedKeywords = managedKeywords
    }

    enum CodingKeys: String, CodingKey {
        case assetID = "assetId"
        case title, caption, keywords, managedKeywords
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        assetID = try container.decode(String.self, forKey: .assetID)
        title = try container.decodeIfPresent(String.self, forKey: .title) ?? ""
        caption = try container.decodeIfPresent(String.self, forKey: .caption) ?? ""
        keywords = try container.decodeIfPresent([String].self, forKey: .keywords) ?? []
        managedKeywords = try container.decodeIfPresent([String].self, forKey: .managedKeywords) ?? []
    }
}

enum PhotoMetadataAutomation {
    static func read(assetIDs: [String]) throws -> Data {
        let requests = assetIDs.map { ["assetId": $0] }
        return try run(requestData: JSONSerialization.data(withJSONObject: requests), commit: false)
    }

    static func apply(requests: [PhotoMetadataApplyRequest]) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return try run(requestData: encoder.encode(requests), commit: true)
    }

    private static func run(requestData: Data, commit: Bool) throws -> Data {
        let payload = requestData.base64EncodedString()
        let source = """
        ObjC.import('Foundation');
        function decode(value) {
          const data = $.NSData.alloc.initWithBase64EncodedStringOptions(value, 0);
          const text = $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding).js;
          return JSON.parse(text);
        }
        function run() {
          const requests = decode('\(payload)');
          const photos = Application('Photos');
          const managedPrefixes = ['PBE:Rating:', 'PBE:Color:', 'PBE-Rating-', 'PBE-Color-', 'PBE-Fixture-ID:'];
          const isManaged = value =>
            value === 'PBE:Approved' ||
            value === 'PBE:Tombstone' ||
            value === 'PBE-Approved' ||
            managedPrefixes.some(prefix => value.startsWith(prefix));
          const readOne = request => {
            const id = String(request.assetId || '');
            try {
              const item = photos.mediaItems.byId(id);
              let foundId;
              try { foundId = item.id(); } catch (error) {
                return {assetId: id, error: `lookup failed: ${String(error)}`};
              }
              if (foundId !== id) return {assetId: id, error: 'lookup returned a different Photos asset'};
              let title;
              try { title = item.name() || ''; } catch (error) {
                return {assetId: id, error: `title read failed: ${String(error)}`};
              }
              let caption;
              try { caption = item.description() || ''; } catch (error) {
                return {assetId: id, error: `caption read failed: ${String(error)}`};
              }
              let keywords;
              try { keywords = item.keywords() || []; } catch (error) {
                return {assetId: id, error: `keyword read failed: ${String(error)}`};
              }
              return {assetId: id, title, caption, keywords};
            } catch (error) {
              return {assetId: id, error: `metadata read failed: ${String(error)}`};
            }
          };
          const applyOne = request => {
            const id = String(request.assetId || '');
            try {
              const item = photos.mediaItems.byId(id);
              if (item.id() !== id) throw new Error(`Apple Photos asset not found: ${id}`);
              const before = {
                title: item.name() || '',
                caption: item.description() || '',
                keywords: item.keywords() || [],
              };
              const desired = Array.isArray(request.keywords) ? request.keywords.map(String) : [];
              const managed = Array.isArray(request.managedKeywords) ? request.managedKeywords.map(String) : [];
              const managedSet = new Set(managed);
              const keywords = [];
              const seen = new Set();
              [...before.keywords.map(String), ...desired, ...managed].forEach(value => {
                const clean = String(value || '').trim();
                const key = clean.toLocaleLowerCase();
                if (!clean || seen.has(key) || (isManaged(clean) && !managedSet.has(clean))) return;
                seen.add(key);
                keywords.push(clean);
              });
              item.name = String(request.title || '');
              item.description = String(request.caption || '');
              item.keywords = keywords;
              const after = {
                title: item.name() || '',
                caption: item.description() || '',
                keywords: item.keywords() || [],
              };
              return {assetId: id, before, after, keywords};
            } catch (error) {
              return {assetId: id, error: String(error)};
            }
          };
          const items = requests.map(request => \(commit ? "applyOne(request)" : "readOne(request)"));
          return JSON.stringify(items);
        }
        """
        guard let language = OSALanguage(forName: "JavaScript") else {
            throw PhotoMetadataAutomationError.unavailable
        }
        let script = OSAScript(source: source, language: language)
        var errorInfo: NSDictionary?
        guard let descriptor = script.executeAndReturnError(&errorInfo),
              let resultString = descriptor.stringValue,
              let resultData = resultString.data(using: .utf8),
              let items = try JSONSerialization.jsonObject(with: resultData) as? [[String: Any]] else {
            let message = errorInfo?[NSLocalizedDescriptionKey] as? String
                ?? "Backstage could not run Photos metadata automation."
            throw PhotoMetadataAutomationError.failed(message)
        }
        return try responseData(items: items, commit: commit)
    }

    static func responseData(items: [[String: Any]], commit: Bool) throws -> Data {
        try JSONSerialization.data(withJSONObject: [
            "ok": true,
            "mode": commit
                ? BackstagePreviewIPCConstants.metadataApplyManyOperation
                : BackstagePreviewIPCConstants.metadataReadManyOperation,
            "count": items.count,
            "items": items,
        ], options: [.sortedKeys])
    }
}

enum PhotoMetadataAutomationError: Error, LocalizedError {
    case unavailable
    case failed(String)

    var errorDescription: String? {
        switch self {
        case .unavailable:
            return "JavaScript for Automation is unavailable on this Mac."
        case .failed(let message):
            return message
        }
    }
}

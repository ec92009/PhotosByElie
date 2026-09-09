public enum FixtureCullingView: String, Codable, Sendable, CaseIterable {
    case undecided
    case hidden
    case picked
    case uploaded
    case uploadedWithoutApproval = "uploaded-without-approval"
    case allActive = "all-active"

    public var label: String {
        switch self {
        case .undecided: "Undecided"
        case .hidden: "Hidden"
        case .picked: "Picked"
        case .uploaded: "Uploaded"
        case .uploadedWithoutApproval: "Uploaded without approval"
        case .allActive: "All Active"
        }
    }

    public static var selectableCases: [Self] { [.undecided, .picked, .hidden, .uploaded] }
}

import OwnerCore

extension FixtureAsset {
    var galleryStateBadges: [String] {
        let uploadBadge = deliveryState == "live"
            && ![.fullResolutionUploaded, .publishing, .live, .sold].contains(workflowStage)
            ? ["R2 Uploaded"]
            : []
        return [workflowStage.label]
            + uploadBadge
            + (sourceAvailable ? [] : ["Source Unavailable"])
    }
}

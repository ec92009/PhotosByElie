# PBB-144: labeled GroupBox AX workaround

## Scope

PBB-144 is a Backstage-side workaround for the external Sky Computer Use crash
tracked by PBB-72. It changes presentation structure only. Authentication,
Photos, Owner, fixture, publication, and lifecycle behavior remain unchanged.

## Reduced reproducer

This labeled SwiftUI shape closes the Sky native pipe when the content exposes
an accessible child:

```swift
GroupBox("This Mac") {
    Text("Authenticated")
}
```

The stable equivalent keeps the semantic heading adjacent to an unlabeled
card:

```swift
VStack(alignment: .leading) {
    Text("This Mac")
        .font(.headline)
        .accessibilityAddTraits(.isHeader)
    GroupBox {
        Text("Authenticated")
    }
}
```

`BackstageSectionCard` owns that shape. Every previously labeled GroupBox in
Overview, Updates, and Fixtures uses the component. The source-contract test
fails if a labeled GroupBox returns anywhere in the Backstage application
surface.

## Acceptance boundary

The reusable component and automated suites prove the failing source shape is
absent. A signed installed build must still pass repeated live Computer Use
reads on Overview, Updates, and representative Fixtures states before PBB-144
can be Verified. PBB-72 remains open because this workaround does not repair
the external observer implementation.

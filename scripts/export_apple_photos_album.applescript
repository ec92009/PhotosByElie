on run argv
	if (count of argv) is less than 2 then error "Usage: osascript export_apple_photos_album.applescript <album name> <destination folder>"

	set albumName to item 1 of argv
	set destinationPath to item 2 of argv
	set destinationFolder to POSIX file destinationPath as alias

	tell application "Photos"
		set matchingAlbums to albums whose name is albumName
		if (count of matchingAlbums) is 0 then error "Apple Photos album not found: " & albumName
		if (count of matchingAlbums) is greater than 1 then error "Multiple Apple Photos albums named: " & albumName

		set sourceAlbum to item 1 of matchingAlbums
		set albumItems to media items of sourceAlbum
		set albumCount to count of albumItems
		if albumCount is 0 then error "Apple Photos album is empty: " & albumName

		-- Deliberately omit "using originals"; this exports current rendered versions,
		-- not RAW/DNG/NEF originals.
		export albumItems to destinationFolder
	end tell

	return "Exported " & albumCount & " Apple Photos items from " & albumName & " to " & destinationPath
end run

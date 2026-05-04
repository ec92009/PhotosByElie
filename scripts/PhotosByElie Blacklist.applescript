on open droppedItems
	repeat with itemPath in droppedItems
		set posixPath to POSIX path of itemPath
		do shell script "/usr/bin/python3 " & quoted form of "/Users/ecohen/Dev/photosByElie/scripts/apply_blacklist.py" & " " & quoted form of posixPath
	end repeat
	display notification "Blacklist applied." with title "PhotosByElie"
end open

on run
	set chosenFile to choose file with prompt "Choose a .pbe-blacklist file"
	open {chosenFile}
end run

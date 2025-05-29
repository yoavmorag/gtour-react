#!/bin/bash

SOURCE_DIR="../gtour/data"
DEST_DIR="./public/data"

# Ensure the source directory exists
if [ ! -d "$SOURCE_DIR" ]; then
    echo "Error: Source directory '$SOURCE_DIR' does not exist."
    exit 1
fi

# Ensure the destination directory exists (create if not)
if [ ! -d "$DEST_DIR" ]; then
    echo "Destination directory '$DEST_DIR' does not exist. Creating it."
    mkdir -p "$DEST_DIR" || { echo "Error: Could not create destination directory."; exit 1; }
fi

echo "Starting continuous sync from '$SOURCE_DIR' to '$DEST_DIR'..."
echo "Press Ctrl+C to stop."

# Initial sync
echo "Performing initial sync..."
rsync -av "$SOURCE_DIR/" "$DEST_DIR/"
echo "Initial sync complete."

while true; do
    echo "Waiting for changes in '$SOURCE_DIR'..."
    # Watch for specific events: modify, create, delete, move
    # -r: recursive
    # -e: specify events
    # --format %w%f: output full path including watch directory
    # --timeout 0: wait indefinitely
    # --exclude: exclude patterns if needed (e.g., --exclude '.*~')
    inotifywait -r -e modify,create,delete,move --format '%w%f' --timeout 0 "$SOURCE_DIR"

    # A short delay to allow for multiple rapid changes to settle
    # This prevents rsync from running for every single file change
    sleep 2

    echo "Changes detected! Syncing..."
    # --delete ensures files removed from source are removed from destination
    # -q: quiet mode for rsync, less output unless errors
    rsync -av --delete "$SOURCE_DIR/" "$DEST_DIR/"
    echo "Sync complete."
done

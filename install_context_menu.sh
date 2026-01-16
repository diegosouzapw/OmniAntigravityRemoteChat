#!/bin/bash

# Antigravity - Right-Click Context Menu Manager (Linux - Nautilus/GNOME)
echo "==================================================="
echo "  Antigravity - Right-Click Context Menu Manager"
echo "==================================================="
echo ""
echo "This tool manages 'Open with Antigravity (Debug)' in your"
echo "Nautilus/GNOME file manager Right-Click menu."
echo ""
echo "WHAT IT DOES:"
echo "  - Adds/Removes a script in ~/.local/share/nautilus/scripts/"
echo "  - Adds a new option when you right-click a folder"
echo "  - Clicking it will run: antigravity . --remote-debugging-port=9000"
echo ""
echo "REQUIREMENTS:"
echo "  - Nautilus file manager (GNOME)"
echo "  - Antigravity CLI must be installed and in your PATH"
echo ""
echo "NOTE: This only works on Linux with Nautilus."
echo "      For macOS, see README.md for Automator Quick Action setup."
echo ""
echo "==================================================="
echo ""
echo "Choose an option:"
echo "  [1] Install - Add Right-Click menu"
echo "  [2] Remove  - Remove Right-Click menu"
echo "  [3] Backup  - Copy existing script before changes"
echo "  [4] Exit"
echo ""

read -p "Enter choice (1-4): " choice

NAUTILUS_PATH="$HOME/.local/share/nautilus/scripts"
SCRIPT_FILE="$NAUTILUS_PATH/Open with Antigravity (Debug)"
BACKUP_DIR="$HOME/.local/share/nautilus/scripts_backup"

case $choice in
    1)
        echo ""
        echo "[INSTALL] Creating Nautilus script..."
        
        # Create directory if needed
        if [ ! -d "$NAUTILUS_PATH" ]; then
            mkdir -p "$NAUTILUS_PATH"
        fi
        
        echo "#!/bin/bash" > "$SCRIPT_FILE"
        echo "# Antigravity context menu script" >> "$SCRIPT_FILE"
        echo "cd \"\$NAUTILUS_SCRIPT_CURRENT_URI\" 2>/dev/null || cd \"\$(pwd)\"" >> "$SCRIPT_FILE"
        echo "antigravity . --remote-debugging-port=9000" >> "$SCRIPT_FILE"
        chmod +x "$SCRIPT_FILE"
        
        echo ""
        echo "[SUCCESS] Context menu installed!"
        echo ""
        echo "You can now right-click any folder in Nautilus and select:"
        echo "  Scripts > Open with Antigravity (Debug)"
        ;;
    2)
        echo ""
        echo "[REMOVE] Deleting Nautilus script..."
        
        if [ -f "$SCRIPT_FILE" ]; then
            rm "$SCRIPT_FILE"
            echo ""
            echo "[SUCCESS] Context menu removed!"
        else
            echo ""
            echo "[INFO] No Antigravity context menu script found."
        fi
        ;;
    3)
        echo ""
        echo "[BACKUP] Backing up existing script..."
        
        if [ -f "$SCRIPT_FILE" ]; then
            mkdir -p "$BACKUP_DIR"
            BACKUP_FILE="$BACKUP_DIR/antigravity_backup_$(date +%Y%m%d_%H%M%S).sh"
            cp "$SCRIPT_FILE" "$BACKUP_FILE"
            echo ""
            echo "[SUCCESS] Backup saved to: $BACKUP_FILE"
        else
            echo ""
            echo "[INFO] No existing Antigravity context menu script found to backup."
        fi
        ;;
    4)
        echo "[EXIT] No changes made."
        exit 0
        ;;
    *)
        echo "[ERROR] Invalid choice."
        ;;
esac

echo ""
read -p "Press Enter to exit..."

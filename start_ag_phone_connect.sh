#!/bin/bash

# Antigravity Phone Connect - Mac/Linux Launcher
echo "==================================================="
echo "  Antigravity Phone Connect Launcher"
echo "==================================================="

# Check for .env file
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        echo "[INFO] .env file not found. Creating from .env.example..."
        cp .env.example .env
        echo "[SUCCESS] .env created from template!"
        echo "[ACTION] Please update .env if you wish to change defaults."
        echo ""
    fi
fi

# Check for Python
if command -v python3 &> /dev/null; then
    PYTHON_CMD="python3"
elif command -v python &> /dev/null; then
    PYTHON_CMD="python"
else
    echo "[ERROR] Python is not installed. Please install Python to run the launcher."
    exit 1
fi

echo "[STARTING] Launching via Unified Launcher..."
$PYTHON_CMD launcher.py --mode local

# Keep terminal open if server crashes
echo ""
echo "[INFO] Server stopped."
read -p "Press Enter to exit..."


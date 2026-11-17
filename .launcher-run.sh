#!/bin/bash
cd "$(dirname "$0")" || exit 1
python3 ./downtime.py
status=$?
echo
if [[ $status -ne 0 ]]; then
  echo "The program exited with status $status."
fi
read -r -p "Press Enter to close..."
exit "$status"

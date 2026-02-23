#!/bin/bash
# Upload a lesson video to the deployed API.
# Usage: ./scripts/upload-video.sh <API_BASE_URL> <ADMIN_EMAIL> <ADMIN_PASSWORD> <LESSON_ID> <VIDEO_FILE>
# Example: ./scripts/upload-video.sh http://72.61.224.223:3001 admin@engleash.com password123 1 ./my-lesson.mp4

set -e
API_URL="$1"
EMAIL="$2"
PASS="$3"
LESSON_ID="$4"
VIDEO_FILE="$5"

if [ -z "$API_URL" ] || [ -z "$EMAIL" ] || [ -z "$PASS" ] || [ -z "$LESSON_ID" ] || [ -z "$VIDEO_FILE" ]; then
  echo "Usage: $0 <API_BASE_URL> <ADMIN_EMAIL> <ADMIN_PASSWORD> <LESSON_ID> <VIDEO_FILE>"
  echo "Example: $0 http://72.61.224.223:3001 admin@engleash.com password123 1 ./lesson1.mp4"
  exit 1
fi

TOKEN=$(curl -s -X POST "$API_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"role\":\"Admin\"}" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);console.log(j.token||'')})")

if [ -z "$TOKEN" ]; then
  echo "Failed to get token. Check API URL and credentials."
  exit 1
fi

curl -X POST "$API_URL/api/uploads/lesson/$LESSON_ID/video" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@$VIDEO_FILE"

echo ""
echo "Done. Lesson $LESSON_ID video uploaded."

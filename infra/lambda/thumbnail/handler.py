"""
Thumbnail Generator Lambda
==========================
Triggered on S3 PutObject for screenshots/* in servicesync-advisor-data.
Generates a 400px-wide JPEG thumbnail and uploads to the same bucket under
a 'thumbs/' sub-path mirroring the original key structure.

E.g.:
  Input:  screenshots/siltaylor-chevyland/2026/07/22/1753275600000.jpg
  Output: screenshots/siltaylor-chevyland/2026/07/22/thumbs/1753275600000.jpg

Requires: Pillow (PIL) layer
"""
import boto3
from io import BytesIO
from PIL import Image
import os

s3 = boto3.client('s3')
BUCKET = os.environ.get('BUCKET', 'servicesync-advisor-data')
THUMB_WIDTH = 400
THUMB_QUALITY = 50


def lambda_handler(event, context):
    """Process S3 event records and generate thumbnails."""
    processed = 0
    
    for record in event.get('Records', []):
        key = record['s3']['object']['key']
        
        # Skip if already a thumbnail
        if '/thumbs/' in key:
            continue
        
        # Skip non-image files
        if not key.lower().endswith(('.jpg', '.jpeg', '.png', '.webp')):
            continue
        
        try:
            # Download original
            obj = s3.get_object(Bucket=BUCKET, Key=key)
            img = Image.open(BytesIO(obj['Body'].read()))
            
            # Resize maintaining aspect ratio
            ratio = THUMB_WIDTH / img.width
            new_height = int(img.height * ratio)
            thumb = img.resize((THUMB_WIDTH, new_height), Image.LANCZOS)
            
            # Convert to RGB if necessary (e.g., PNG with alpha)
            if thumb.mode in ('RGBA', 'P'):
                thumb = thumb.convert('RGB')
            
            # Encode to JPEG
            buf = BytesIO()
            thumb.save(buf, format='JPEG', quality=THUMB_QUALITY, optimize=True)
            buf.seek(0)
            
            # Build thumbnail key: insert 'thumbs/' before the filename
            parts = key.rsplit('/', 1)
            if len(parts) == 2:
                thumb_key = f"{parts[0]}/thumbs/{parts[1]}"
            else:
                thumb_key = f"thumbs/{key}"
            
            # Ensure .jpg extension
            thumb_key = thumb_key.rsplit('.', 1)[0] + '.jpg'
            
            # Upload thumbnail
            s3.put_object(
                Bucket=BUCKET,
                Key=thumb_key,
                Body=buf.getvalue(),
                ContentType='image/jpeg',
                CacheControl='max-age=86400',
            )
            
            processed += 1
            print(f"Generated thumbnail: {thumb_key} ({buf.tell()} bytes)")
            
        except Exception as e:
            print(f"Error processing {key}: {e}")
            continue
    
    return {
        'statusCode': 200,
        'body': f'Processed {processed} thumbnails'
    }

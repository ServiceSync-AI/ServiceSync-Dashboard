"""
servicesync-heartbeat Lambda
Stores service heartbeat data in DynamoDB (overwrite latest per advisor).
POST /heartbeat
Body: { advisor_id, services: { rewind, ambient, chrome }, timestamp }
"""
import json
import boto3
from datetime import datetime, timezone

dynamodb = boto3.resource('dynamodb', region_name='us-east-1')
table = dynamodb.Table('servicesync-heartbeats')


def lambda_handler(event, context):
    try:
        body = json.loads(event.get('body', '{}'))
    except (json.JSONDecodeError, TypeError):
        return {
            'statusCode': 400,
            'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
            'body': json.dumps({'error': 'Invalid JSON body'})
        }

    advisor_id = body.get('advisor_id')
    services = body.get('services', {})
    timestamp = body.get('timestamp', datetime.now(timezone.utc).isoformat())

    if not advisor_id:
        return {
            'statusCode': 400,
            'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
            'body': json.dumps({'error': 'advisor_id is required'})
        }

    # Overwrite the latest heartbeat for this advisor
    table.put_item(Item={
        'advisor_id': advisor_id,
        'services': services,
        'timestamp': timestamp,
        'received_at': datetime.now(timezone.utc).isoformat()
    })

    return {
        'statusCode': 200,
        'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
        'body': json.dumps({'status': 'ok', 'advisor_id': advisor_id, 'timestamp': timestamp})
    }

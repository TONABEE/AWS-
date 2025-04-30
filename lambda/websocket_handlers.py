import json
import os
import boto3
from datetime import datetime

dynamodb = boto3.client('dynamodb')
apigateway = boto3.client('apigatewaymanagementapi')

def connect_handler(event, context):
    """WebSocket接続時のハンドラー"""
    connection_id = event['requestContext']['connectionId']
    
    try:
        # 接続情報をDynamoDBに保存
        dynamodb.put_item(
            TableName=os.environ['CONNECTIONS_TABLE'],
            Item={
                'connectionId': {'S': connection_id},
                'timestamp': {'N': str(int(datetime.now().timestamp()))},
                'connected': {'BOOL': True}
            }
        )
        
        return {
            'statusCode': 200,
            'body': json.dumps('Connected')
        }
    except Exception as e:
        return {
            'statusCode': 500,
            'body': json.dumps(f'Failed to connect: {str(e)}')
        }

def disconnect_handler(event, context):
    """WebSocket切断時のハンドラー"""
    connection_id = event['requestContext']['connectionId']
    
    try:
        # 接続情報をDynamoDBから削除
        dynamodb.delete_item(
            TableName=os.environ['CONNECTIONS_TABLE'],
            Key={
                'connectionId': {'S': connection_id}
            }
        )
        
        return {
            'statusCode': 200,
            'body': json.dumps('Disconnected')
        }
    except Exception as e:
        return {
            'statusCode': 500,
            'body': json.dumps(f'Failed to disconnect: {str(e)}')
        }

def default_handler(event, context):
    """メッセージ受信時のハンドラー"""
    connection_id = event['requestContext']['connectionId']
    domain = event['requestContext']['domainName']
    stage = event['requestContext']['stage']
    
    try:
        # メッセージの内容を解析
        body = json.loads(event['body'])
        message_type = body.get('type')
        data = body.get('data')
        
        # APIGatewayクライアントの設定
        apigateway_management = boto3.client(
            'apigatewaymanagementapi',
            endpoint_url=f'https://{domain}/{stage}'
        )
        
        if message_type == 'flowchart_update':
            # フロー図の更新を処理
            handle_flowchart_update(connection_id, data, apigateway_management)
        elif message_type == 'comment':
            # コメントの追加を処理
            handle_comment(connection_id, data, apigateway_management)
        elif message_type == 'team_action':
            # チーム関連のアクションを処理
            handle_team_action(connection_id, data, apigateway_management)
        
        return {
            'statusCode': 200,
            'body': json.dumps('Message processed')
        }
    except Exception as e:
        return {
            'statusCode': 500,
            'body': json.dumps(f'Failed to process message: {str(e)}')
        }

def handle_flowchart_update(connection_id, data, apigateway):
    """フロー図の更新を処理する関数"""
    try:
        # フロー図の更新をDynamoDBに保存
        dynamodb.put_item(
            TableName=os.environ['FLOWCHARTS_TABLE'],
            Item={
                'flowchartId': {'S': data['flowchartId']},
                'userId': {'S': data['userId']},
                'data': {'S': json.dumps(data['flowchart'])},
                'timestamp': {'N': str(int(datetime.now().timestamp()))}
            }
        )
        
        # チームメンバーに更新を通知
        team_connections = get_team_connections(data['teamId'])
        for conn_id in team_connections:
            if conn_id != connection_id:  # 送信者以外に通知
                send_to_connection(apigateway, conn_id, {
                    'type': 'flowchart_update',
                    'data': data['flowchart']
                })
    except Exception as e:
        print(f"Error handling flowchart update: {str(e)}")

def handle_comment(connection_id, data, apigateway):
    """コメントの追加を処理する関数"""
    try:
        # コメントをDynamoDBに保存
        dynamodb.put_item(
            TableName=os.environ['COMMENTS_TABLE'],
            Item={
                'nodeId': {'S': data['nodeId']},
                'commentId': {'S': str(datetime.now().timestamp())},
                'userId': {'S': data['userId']},
                'content': {'S': data['content']},
                'timestamp': {'N': str(int(datetime.now().timestamp()))}
            }
        )
        
        # チームメンバーにコメントを通知
        team_connections = get_team_connections(data['teamId'])
        for conn_id in team_connections:
            if conn_id != connection_id:
                send_to_connection(apigateway, conn_id, {
                    'type': 'new_comment',
                    'data': data
                })
    except Exception as e:
        print(f"Error handling comment: {str(e)}")

def handle_team_action(connection_id, data, apigateway):
    """チーム関連のアクションを処理する関数"""
    try:
        action_type = data['actionType']
        
        if action_type == 'join_team':
            # チームへの参加を処理
            dynamodb.put_item(
                TableName=os.environ['TEAM_DATA_TABLE'],
                Item={
                    'teamId': {'S': data['teamId']},
                    'userId': {'S': data['userId']},
                    'role': {'S': data['role']},
                    'timestamp': {'N': str(int(datetime.now().timestamp()))}
                }
            )
        elif action_type == 'leave_team':
            # チームからの退出を処理
            dynamodb.delete_item(
                TableName=os.environ['TEAM_DATA_TABLE'],
                Key={
                    'teamId': {'S': data['teamId']},
                    'userId': {'S': data['userId']}
                }
            )
        
        # チームメンバーに変更を通知
        team_connections = get_team_connections(data['teamId'])
        for conn_id in team_connections:
            send_to_connection(apigateway, conn_id, {
                'type': 'team_update',
                'data': data
            })
    except Exception as e:
        print(f"Error handling team action: {str(e)}")

def get_team_connections(team_id):
    """チームメンバーの接続IDを取得する関数"""
    try:
        # チームメンバーを取得
        team_members = dynamodb.query(
            TableName=os.environ['TEAM_DATA_TABLE'],
            KeyConditionExpression='teamId = :teamId',
            ExpressionAttributeValues={
                ':teamId': {'S': team_id}
            }
        )['Items']
        
        # メンバーの接続情報を取得
        connections = []
        for member in team_members:
            member_connections = dynamodb.query(
                TableName=os.environ['CONNECTIONS_TABLE'],
                IndexName='UserConnections',
                KeyConditionExpression='userId = :userId',
                ExpressionAttributeValues={
                    ':userId': {'S': member['userId']['S']}
                }
            )['Items']
            connections.extend([conn['connectionId']['S'] for conn in member_connections])
        
        return connections
    except Exception as e:
        print(f"Error getting team connections: {str(e)}")
        return []

def send_to_connection(apigateway, connection_id, data):
    """特定の接続にメッセージを送信する関数"""
    try:
        apigateway.post_to_connection(
            ConnectionId=connection_id,
            Data=json.dumps(data)
        )
    except Exception as e:
        print(f"Error sending message to connection {connection_id}: {str(e)}")
        if "GoneException" in str(e):
            # 接続が切れている場合は接続情報を削除
            try:
                dynamodb.delete_item(
                    TableName=os.environ['CONNECTIONS_TABLE'],
                    Key={
                        'connectionId': {'S': connection_id}
                    }
                )
            except Exception as del_e:
                print(f"Error deleting connection: {str(del_e)}") 
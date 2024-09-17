import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from '@aws-sdk/client-sqs';
import {
  AttributeValue,
  DynamoDBClient,
  PutItemCommand,
  QueryCommand,
  UpdateItemCommand,
  UpdateItemCommandInput,
} from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class ConsumerService implements OnModuleInit {
  private readonly sqsClient: SQSClient;
  private readonly dynamoDBClient: DynamoDBClient;
  private readonly queueUrl: string;
  private readonly tableName: string;
  private readonly logger = new Logger(ConsumerService.name);
  private readonly pollingInterval = 10000; // 30 seconds

  constructor() {
    this.dynamoDBClient = new DynamoDBClient({
      region: 'us-east-1',
    });

    this.tableName = process.env.TABLENAME;
    this.sqsClient = new SQSClient({ region: process.env.REGION }); // AWS region
    this.queueUrl = process.env.TEST_QUEUE;
  }

  async onModuleInit() {
    this.pollQueue();
  }

  private async pollQueue() {
    try {
      const command = new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 20,
      });

      const response = await this.sqsClient.send(command);

      if (response.Messages && response.Messages.length > 0) {
        for (const message of response.Messages) {
          this.logger.log(message.Body);
          await this.handleUserEvent(message);

          // Delete message after processing
          await this.sqsClient.send(
            new DeleteMessageCommand({
              QueueUrl: this.queueUrl,
              ReceiptHandle: message.ReceiptHandle!,
            }),
          );
        }

        // Continue polling as there are messages
        this.pollQueue();
      } else {
        // No messages, wait and poll again
        this.logger.log('Queue is empty, waiting before next poll...');
        setTimeout(() => this.pollQueue(), this.pollingInterval);
      }
    } catch (error) {
      this.logger.error('Error polling SQS queue:', error);
      // Optionally add a delay before retrying in case of error
      setTimeout(() => this.pollQueue(), this.pollingInterval);
    }
  }
  private async handleUserEvent(message: any) {
    try {
      if (!message.Body) {
        throw new Error('Message body is missing');
      }

      const body = JSON.parse(message.Body);

      if (!body.user || !body.operation) {
        throw new Error('Invalid message structure');
      }

      const user = body.user;
      const operation = body.operation;

      const params = {
        TableName: this.tableName,
        Item: marshall(
          {
            id: uuidv4(),
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            dob: user.dob,
            status: user.status || 'active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          {
            removeUndefinedValues: true, // Add this option
          },
        ),
      };

      if (operation === 'create') {
        try {
          const command = new PutItemCommand(params);
          await this.dynamoDBClient.send(command);
          this.logger.log(`User ${body.user.firstName} created successfully.`);
        } catch (error) {
          this.logger.error('Error creating user in DynamoDB', error);
        }
      } else if (operation === 'update') {
        if (!user.id) {
          throw new Error('Correct ID required for update operation');
        }

        const updateExpression =
          'SET #firstName = :firstName, #lastName = :lastName, #dob = :dob, #updatedAt = :updatedAt, #status = :status';
        const expressionAttributeValues: Record<string, AttributeValue> = {
          ':firstName': { S: user.firstName || '' },
          ':lastName': { S: user.lastName || '' },
          ':dob': { S: user.dob || '' },
          ':updatedAt': { S: new Date().toISOString() },
          ':status': { S: 'updated' },
        };
        const expressionAttributeNames: Record<string, string> = {
          '#firstName': 'firstName',
          '#lastName': 'lastName',
          '#dob': 'dob',
          '#updatedAt': 'updatedAt',
          '#status': 'status',
        };

        const params: UpdateItemCommandInput = {
          TableName: this.tableName,
          Key: marshall({
            id: user.id,
          }),
          UpdateExpression: updateExpression,
          ExpressionAttributeValues: expressionAttributeValues,
          ExpressionAttributeNames: expressionAttributeNames,
          ConditionExpression: 'attribute_exists(id)',
        };

        try {
          const command = new UpdateItemCommand(params);
          await this.dynamoDBClient.send(command);
          this.logger.log(`User ${user.id} updated successfully.`);
        } catch (error) {
          this.logger.error('Error updating user in DynamoDB', error);
          throw new BadRequestException('Failed to update user');
        }
      } else if (operation === 'updateStatus') {
        if (!user.id) {
          throw new BadRequestException(
            'ID required for status update operation',
          );
        }

        const updateExpression =
          'SET #status = :status, updatedAt = :updatedAt';
        const expressionAttributeValues: Record<string, AttributeValue> = {
          ':status': { S: user.status || '' },
          ':updatedAt': { S: new Date().toISOString() },
        };

        const params: UpdateItemCommandInput = {
          TableName: this.tableName,
          Key: marshall({
            id: user.id,
          }),
          UpdateExpression: updateExpression,
          ExpressionAttributeValues: expressionAttributeValues,
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ConditionExpression: 'attribute_exists(id)',
        };

        try {
          const command = new UpdateItemCommand(params);
          await this.dynamoDBClient.send(command);
          this.logger.log(`User ${user.id} status updated successfully.`);
        } catch (error) {
          this.logger.error('Error updating user in DynamoDB', error);
          throw new BadRequestException('Failed to update user');
        }
      } else {
        this.logger.warn(`Unknown operation: ${operation}`);
      }
    } catch (error) {
      this.logger.error('Error handling SQS message:', error);
    }
  }
  async getUserStatus(email: string, dob: string) {
    if (!email || !dob) {
      throw new BadRequestException(
        'Both email and date of birth must be provided.',
      );
    }

    try {
      const commandInput = {
        TableName: this.tableName,
        IndexName: 'email-dob-index',
        KeyConditionExpression: 'email = :email AND dob = :dob',
        ExpressionAttributeValues: {
          ':email': { S: email },
          ':dob': { S: dob },
        },
      };
      const command = new QueryCommand(commandInput);
      const response = await this.dynamoDBClient.send(command);

      if (response.Items && response.Items.length > 0) {
        const user = response.Items[0];
        const id = user.id.S;
        const status = user.status.S;
        return { id, status };
      } else {
        throw new BadRequestException('User not found');
      }
    } catch (error) {
      this.logger.error('Error checking user status:', error);
      throw new BadRequestException('Failed to check user status');
    }
  }
  async getEntireUserDetails(id: string) {
    if (!id) {
      throw new BadRequestException(
        'Both email and date of birth must be provided.',
      );
    }

    try {
      const commandInput = {
        TableName: this.tableName,
        KeyConditionExpression: 'id = :id',
        ExpressionAttributeValues: {
          ':id': { S: id },
        },
      };
      const command = new QueryCommand(commandInput);
      const response = await this.dynamoDBClient.send(command);

      if (response.Items && response.Items.length > 0) {
        const user = response.Items[0];
        console.log('======>', user);
        return { user };
      } else {
        throw new BadRequestException('User not found');
      }
    } catch (error) {
      this.logger.error('Error checking user status:', error);
      throw new BadRequestException('Failed to check user status');
    }
  }
}

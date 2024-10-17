import { Test, TestingModule } from '@nestjs/testing';
import { ConsumerService } from './consumer.service';
import {
  SQSClient,
  // ReceiveMessageCommand,
  // DeleteMessageCommand,
} from '@aws-sdk/client-sqs';
import {
  DynamoDBClient,
  PutItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { BadRequestException } from '@nestjs/common';

jest.mock('@aws-sdk/client-sqs');
jest.mock('@aws-sdk/client-dynamodb');

describe('ConsumerService', () => {
  let service;
  let sqsClient: SQSClient;
  let dynamoDBClient: DynamoDBClient;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ConsumerService],
    }).compile();

    service = module.get<ConsumerService>(ConsumerService);
    sqsClient = new SQSClient({});
    dynamoDBClient = new DynamoDBClient({});
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('pollQueue', () => {
    it('should process messages and delete them from the queue', async () => {
      const mockMessages = [
        {
          Body: JSON.stringify({
            user: {
              firstName: 'John',
              lastName: 'Doe',
              email: 'john@example.com',
              dob: '2000-01-01',
              status: 'active',
            },
            operation: 'create',
          }),
          ReceiptHandle: 'mock-receipt-handle',
        },
      ];

      jest
        .spyOn(sqsClient, 'send')
        .mockResolvedValueOnce({ Messages: mockMessages });

      jest.spyOn(dynamoDBClient, 'send').mockResolvedValueOnce({}); // Mock the PutItemCommand

      await service.pollQueue();

      expect(sqsClient.send).toHaveBeenCalledTimes(2); // 1 for ReceiveMessage, 1 for DeleteMessage
      expect(dynamoDBClient.send).toHaveBeenCalledWith(
        expect.any(PutItemCommand),
      );
    });

    it('should log if the queue is empty', async () => {
      jest.spyOn(sqsClient, 'send').mockResolvedValueOnce({ Messages: [] });
      const logSpy = jest.spyOn(service['logger'], 'log');

      await service.pollQueue();

      expect(logSpy).toHaveBeenCalledWith(
        'Queue is empty, waiting before next poll...',
      );
    });

    it('should handle errors gracefully', async () => {
      jest.spyOn(sqsClient, 'send');

      const logSpy = jest.spyOn(service['logger'], 'error');

      await service.pollQueue();

      expect(logSpy).toHaveBeenCalledWith(
        'Error polling SQS queue:',
        expect.any(Error),
      );
    });
  });

  describe('handleUserEvent', () => {
    it('should create a user in DynamoDB', async () => {
      const message = {
        Body: JSON.stringify({
          user: {
            firstName: 'Jane',
            lastName: 'Doe',
            email: 'jane@example.com',
            dob: '1990-01-01',
          },
          operation: 'create',
        }),
      };

      jest.spyOn(dynamoDBClient, 'send').mockResolvedValue();

      await service['handleUserEvent'](message as any);

      expect(dynamoDBClient.send).toHaveBeenCalledWith(
        expect.any(PutItemCommand),
      );
    });

    it('should throw error for invalid message structure', async () => {
      const message = {
        Body: JSON.stringify({}),
      };

      await expect(service['handleUserEvent'](message as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should update a user in DynamoDB', async () => {
      const message = {
        Body: JSON.stringify({
          user: {
            id: 'mock-id',
            firstName: 'Jane',
            lastName: 'Doe',
            dob: '1990-01-01',
          },
          operation: 'update',
        }),
      };

      jest.spyOn(dynamoDBClient, 'send').mockResolvedValueOnce({});

      await service['handleUserEvent'](message as any);

      expect(dynamoDBClient.send).toHaveBeenCalledWith(
        expect.any(UpdateItemCommand),
      );
    });

    it('should throw error for update operation without ID', async () => {
      const message = {
        Body: JSON.stringify({
          user: { firstName: 'Jane', lastName: 'Doe', dob: '1990-01-01' },
          operation: 'update',
        }),
      };

      await expect(service['handleUserEvent'](message as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    // Add more tests for updateStatus and unknown operations as needed.
  });

  describe('getUserStatus', () => {
    it('should return user status', async () => {
      const email = 'john@example.com';
      const dob = '2000-01-01';

      jest.spyOn(dynamoDBClient, 'send').mockResolvedValueOnce({
        Items: [
          {
            id: { S: 'mock-id' },
            status: { S: 'active' },
          },
        ],
      });

      const result = await service.getUserStatus(email, dob);
      expect(result).toEqual({ id: 'mock-id', status: 'active' });
    });

    it('should throw error if user not found', async () => {
      const email = 'unknown@example.com';
      const dob = '2000-01-01';

      jest.spyOn(dynamoDBClient, 'send').mockResolvedValueOnce({ Items: [] });

      await expect(service.getUserStatus(email, dob)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});

/* eslint-disable @typescript-eslint/no-require-imports */
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as dotenv from 'dotenv';
import * as AWSXRay from 'aws-xray-sdk';
dotenv.config();
async function bootstrap() {
  AWSXRay.captureAWS(require('aws-sdk'));
  AWSXRay.setDaemonAddress('52.91.247.140:2000');
  const app = await NestFactory.create(AppModule);
  app.use(AWSXRay.express.openSegment('nestjs-xray-example-consumer'));
  await app.listen(3009);
  app.use(AWSXRay.express.closeSegment());
}
bootstrap();

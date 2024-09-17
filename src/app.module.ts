import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConsumerService } from './consumer/consumer.service';
import { ConsumerController } from './consumer/consumer.controller';

@Module({
  imports: [],
  controllers: [AppController, ConsumerController],
  providers: [AppService, ConsumerService],
})
export class AppModule {}

import { Controller, Get, Query } from '@nestjs/common';
import { ConsumerService } from './consumer.service';

@Controller('consumer')
export class ConsumerController {
  constructor(private readonly consumerService: ConsumerService) {}
  @Get('get-user-Status')
  async getUserDetails(
    @Query('email') email: string,
    @Query('dob') dob: string,
  ) {
    return this.consumerService.getUserStatus(email, dob);
  }
  @Get('get-user-Details')
  async getEntireUserDetails(@Query('id') id: string) {
    return this.consumerService.getEntireUserDetails(id);
  }
}

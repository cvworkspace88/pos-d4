import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CategoryRouter } from './category.router';
import { CategoryService } from './category.service';

@Module({
  imports: [AuthModule],
  providers: [CategoryService, CategoryRouter],
  // MenuService composes the whole menu, categories included.
  exports: [CategoryService],
})
export class CategoryModule {}

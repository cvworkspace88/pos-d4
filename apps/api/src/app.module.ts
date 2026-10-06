import { DynamicModule, Module, Type } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TRPCModule } from 'nestjs-trpc';
import { AddonModule } from './addon/addon.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CategoryModule } from './category/category.module';
import { DbModule } from './db/db.module';
import { Deployment, Domain, MOUNTS } from './deployment-rules';
import { FloorModule } from './floor/floor.module';
import { HealthModule } from './health/health.module';
import { MenuModule } from './menu/menu.module';
import { OutletModule } from './outlet/outlet.module';
import { RoleModule } from './role/role.module';
import { SettingsModule } from './settings/settings.module';
import { SetupModule } from './setup/setup.module';
import { SyncModule } from './sync/sync.module';
import { AppContext } from './trpc/app.context';
import { errorFormatter } from './trpc/error-formatter';

const DOMAIN_MODULES: Record<Domain, Type> = {
  auth: AuthModule,
  settings: SettingsModule,
  setup: SetupModule,
  outlet: OutletModule,
  role: RoleModule,
  category: CategoryModule,
  menu: MenuModule,
  addon: AddonModule,
  audit: AuditModule,
  floor: FloorModule,
  sync: SyncModule,
};

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DbModule,
    TRPCModule.forRoot({ basePath: '/trpc', context: AppContext, errorFormatter }),
    HealthModule,
  ],
  providers: [AppContext],
})
export class AppModule {
  /** Mounts only the domains `deployment` serves; an unmounted module's routers do not exist. */
  static register(deployment: Deployment): DynamicModule {
    return { module: AppModule, imports: MOUNTS[deployment].map((d) => DOMAIN_MODULES[d]) };
  }
}

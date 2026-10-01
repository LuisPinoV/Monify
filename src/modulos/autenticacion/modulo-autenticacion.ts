import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { BaseDatos } from '../../base-datos';
import { ServicioHash } from '../../seguridad/servicio-hash';
import { ControladorAutenticacion } from './controlador-autenticacion';
import { GuardJwt } from './guard-jwt';
import { ServicioAutenticacion } from './servicio-autenticacion';

@Global()
@Module({
  imports: [JwtModule.registerAsync({
    inject: [ConfigService],
    useFactory: (config: ConfigService) => {
      const secret = config.get<string>('JWT_SECRET');
      if (!secret) throw new Error('JWT_SECRET es obligatoria para iniciar la aplicación');
      return { secret, signOptions: { expiresIn: '1h' } };
    }
  })],
  controllers: [ControladorAutenticacion],
  providers: [ServicioAutenticacion, GuardJwt, { provide: APP_GUARD, useExisting: GuardJwt }],
  exports: [ServicioAutenticacion]
})
export class ModuloAutenticacion {}
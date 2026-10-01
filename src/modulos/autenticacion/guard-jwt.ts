import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PUBLICA } from './publico.decorador';

@Injectable()
export class GuardJwt implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const publica = this.reflector.getAllAndOverride<boolean>(PUBLICA, [
      context.getHandler(), context.getClass()
    ]);
    if (publica) return true;

    const request = context.switchToHttp().getRequest<{ headers: { authorization?: string } }>();
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) throw new UnauthorizedException('token de acceso requerido');
    try {
      this.jwt.verify(token);
      return true;
    } catch {
      throw new UnauthorizedException('token de acceso inválido');
    }
  }
}
import { SetMetadata } from '@nestjs/common';

export const PUBLICA = 'publica';
export const Publica = () => SetMetadata(PUBLICA, true);
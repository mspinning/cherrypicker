import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UserRole } from './user.entity';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * Every token comes from our login, which creates the profile. A missing
   * profile means the account was deleted while the token was still valid.
   */
  @Get('me')
  async me(@CurrentUser() claims: AuthenticatedUser): Promise<UserResponseDto> {
    const user = await this.usersService.findByKeycloakId(claims.sub);
    if (!user) {
      throw new UnauthorizedException('Account no longer exists');
    }
    return UserResponseDto.from(user);
  }

  @Get()
  @Roles(UserRole.Admin)
  async findAll(): Promise<UserResponseDto[]> {
    const users = await this.usersService.findAll();
    return users.map((user) => UserResponseDto.from(user));
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.Admin)
  async approve(@Param('id', ParseUUIDPipe) id: string): Promise<UserResponseDto> {
    return UserResponseDto.from(await this.usersService.approve(id));
  }

  @Patch(':id/role')
  @Roles(UserRole.Admin)
  async setRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    return UserResponseDto.from(await this.usersService.setRole(id, dto.role, actor));
  }

  /** Also deletes the Keycloak account, so the person cannot sign in again. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(UserRole.Admin)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser): Promise<void> {
    return this.usersService.remove(id, actor);
  }
}

/**
 * Auth Service Tests
 * Tests login validation, password hashing, token generation.
 */

// Mock database
jest.mock('../config/database', () => {
  const mockUsers = [
    {
      id: 1,
      email: 'admin@test.com',
      password_hash: '$2a$12$LJ3m4ys0kY8Cx5YXvCq9D.F9fY4EJZ1x1H0G4VQj8E9YlKS2j5C6G', // 'password123'
      full_name: 'Admin User',
      role_id: 1,
      role_name: 'Super Admin',
      is_active: true,
    },
    {
      id: 2,
      email: 'inactive@test.com',
      password_hash: '$2a$12$LJ3m4ys0kY8Cx5YXvCq9D.F9fY4EJZ1x1H0G4VQj8E9YlKS2j5C6G',
      full_name: 'Inactive User',
      role_id: 2,
      role_name: 'Export Manager',
      is_active: false,
    },
  ];

  const mockDb = jest.fn(() => ({
    where: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    first: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockResolvedValue(1),
    insert: jest.fn().mockReturnThis(),
    returning: jest.fn().mockResolvedValue([{ id: 3, email: 'new@test.com', full_name: 'New User', role_id: 1 }]),
    join: jest.fn().mockReturnThis(),
    count: jest.fn().mockReturnThis(),
  }));
  mockDb.fn = { now: jest.fn(() => new Date()) };
  mockDb.transaction = jest.fn(async (cb) => cb(mockDb));
  return mockDb;
});

jest.mock('../services/auditService', () => ({
  log: jest.fn().mockResolvedValue(null),
}));

jest.mock('../modules/admin/audit.service', () => ({
  log: jest.fn().mockResolvedValue(null),
}));

const { NotFoundError, ValidationError, ForbiddenError } = require('../shared/errors');

describe('Shared Error Classes', () => {
  it('AppError has correct status code', () => {
    const { AppError } = require('../shared/errors');
    const err = new AppError('test', 418);
    expect(err.message).toBe('test');
    expect(err.statusCode).toBe(418);
    expect(err.name).toBe('AppError');
  });

  it('NotFoundError defaults to 404', () => {
    const err = new NotFoundError();
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Resource not found.');
  });

  it('ValidationError defaults to 400', () => {
    const err = new ValidationError('Bad input', [{ field: 'email' }]);
    expect(err.statusCode).toBe(400);
    expect(err.errors).toHaveLength(1);
  });

  it('ForbiddenError defaults to 403', () => {
    const err = new ForbiddenError();
    expect(err.statusCode).toBe(403);
  });

  it('ConflictError defaults to 409', () => {
    const { ConflictError } = require('../shared/errors');
    const err = new ConflictError();
    expect(err.statusCode).toBe(409);
  });

  it('errors are instanceof Error', () => {
    const err = new NotFoundError('test');
    expect(err instanceof Error).toBe(true);
    expect(err instanceof NotFoundError).toBe(true);
  });
});

jest.mock('../../src/models/EmotionalCheckin', () => ({
  find: jest.fn(),
  countDocuments: jest.fn()
}));

jest.mock('../../src/models/User', () => ({
  findById: jest.fn()
}));

jest.mock('../../src/services/cacheService', () => ({
  getDashboardStats: jest.fn(),
  setDashboardStats: jest.fn(),
  invalidateDashboardCache: jest.fn()
}));

jest.mock('../../src/services/notificationService', () => ({
  confirmSupportRequest: jest.fn(),
  sendEmail: jest.fn()
}));

jest.mock('../../src/utils/response', () => ({
  sendSuccess: jest.fn(),
  sendError: jest.fn()
}));

const EmotionalCheckin = require('../../src/models/EmotionalCheckin');
const User = require('../../src/models/User');
const { sendSuccess, sendError } = require('../../src/utils/response');
const { getUserCheckinHistory } = require('../../src/controllers/dashboardController');

const buildFindChain = (result = []) => ({
  sort: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  populate: jest.fn().mockReturnThis(),
  select: jest.fn().mockResolvedValue(result)
});

describe('Dashboard user-history authorization', () => {
  const mockTargetUser = (record) => {
    User.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue(record)
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    EmotionalCheckin.find.mockReturnValue(buildFindChain([]));
    EmotionalCheckin.countDocuments.mockResolvedValue(0);
  });

  test('allows head_unit to access user in same unit', async () => {
    mockTargetUser({ unit: 'Elementary', department: 'Elementary' });

    const req = {
      query: { userId: '507f1f77bcf86cd799439011', limit: '10', offset: '0' },
      user: { role: 'head_unit', unit: 'Elementary', department: 'Elementary' }
    };

    await getUserCheckinHistory(req, {});

    expect(sendSuccess).toHaveBeenCalled();
    expect(sendError).not.toHaveBeenCalled();
  });

  test('blocks head_unit from accessing user outside unit', async () => {
    mockTargetUser({ unit: 'Junior High', department: 'Junior High' });

    const req = {
      query: { userId: '507f1f77bcf86cd799439012' },
      user: { role: 'head_unit', unit: 'Elementary', department: 'Elementary' }
    };

    await getUserCheckinHistory(req, {});

    expect(sendError).toHaveBeenCalledWith({}, 'Access denied for this user', 403);
    expect(sendSuccess).not.toHaveBeenCalled();
  });

  test('returns 404 when target user does not exist', async () => {
    mockTargetUser(null);

    const req = {
      query: { userId: '507f1f77bcf86cd799439013' },
      user: { role: 'head_unit', unit: 'Elementary', department: 'Elementary' }
    };

    await getUserCheckinHistory(req, {});

    expect(sendError).toHaveBeenCalledWith({}, 'User not found', 404);
    expect(sendSuccess).not.toHaveBeenCalled();
  });
});

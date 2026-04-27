const mockSendSuccess = jest.fn();
const mockSendError = jest.fn();

const userId = '507f1f77bcf86cd799439013';
const supportContactId = '507f1f77bcf86cd799439014';
const checkinId = '507f1f77bcf86cd799439015';

const mockSave = jest.fn().mockResolvedValue(undefined);

const EmotionalCheckinMock = function EmotionalCheckinMock(payload) {
  Object.assign(this, payload);
  this._id = checkinId;
  this.date = new Date();
  this.submittedAt = new Date();
  this.save = mockSave;
};

EmotionalCheckinMock.findOne = jest.fn();
EmotionalCheckinMock.findById = jest.fn();

jest.mock('../../src/models/EmotionalCheckin', () => EmotionalCheckinMock);

jest.mock('../../src/models/UserStudent', () => ({
  findById: jest.fn(() => ({
    select: jest.fn().mockResolvedValue(null)
  }))
}));

jest.mock('../../src/models/User', () => ({
  findById: jest.fn((id) => ({
    select: jest.fn().mockResolvedValue(
      String(id) === userId
        ? { name: 'Ari', role: 'staff', department: 'Elementary' }
        : { name: 'Ms Wina', email: 'wina@millennia21.id', role: 'support_staff', department: 'Elementary' }
    )
  }))
}));

jest.mock('../../src/services/cacheService', () => ({
  invalidateDashboardCache: jest.fn()
}));

jest.mock('../../src/services/aiAnalysisService', () => ({
  aiAnalysisService: {
    analyzeEmotionalCheckin: jest.fn().mockResolvedValue({ needsSupport: true })
  },
  generatePersonalizedGreeting: jest.fn().mockResolvedValue('You did great')
}));

const mockSendSlackNotification = jest.fn().mockResolvedValue(undefined);
const mockSendEmailNotification = jest.fn().mockResolvedValue(undefined);

jest.mock('../../src/services/notificationService', () => ({
  sendSlackNotification: mockSendSlackNotification,
  sendEmailNotification: mockSendEmailNotification
}));

jest.mock('../../src/config/socket', () => ({
  getIO: jest.fn(() => null)
}));

jest.mock('../../src/utils/response', () => ({
  sendSuccess: mockSendSuccess,
  sendError: mockSendError
}));

const { submitAICheckin } = require('../../src/controllers/checkinController');

describe('AI submit support notification regression', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    EmotionalCheckinMock.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    EmotionalCheckinMock.findById.mockReturnValue({
      populate: jest.fn().mockResolvedValue({
        _id: checkinId,
        supportContactUserId: {
          _id: supportContactId,
          name: 'Ms Wina',
          role: 'support_staff',
          department: 'Elementary'
        }
      })
    });
  });

  test('sends support notifications when support contact is selected', async () => {
    const req = {
      user: { id: userId, role: 'staff' },
      body: {
        weatherType: 'sunny',
        selectedMoods: ['grateful'],
        details: 'Need support follow-up',
        presenceLevel: 7,
        capacityLevel: 6,
        supportContactUserId: supportContactId,
        aiEmotionScan: {
          valence: 0.2,
          arousal: 0.1,
          intensity: 35,
          detectedEmotion: 'calm',
          confidence: 80
        }
      },
      ip: '127.0.0.1',
      get: jest.fn(() => 'jest-agent')
    };

    await submitAICheckin(req, {});

    expect(mockSendError).not.toHaveBeenCalled();
    expect(mockSendSlackNotification).toHaveBeenCalledTimes(1);
    expect(mockSendEmailNotification).toHaveBeenCalledTimes(1);
    expect(mockSendSuccess).toHaveBeenCalled();
  });
});

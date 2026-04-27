jest.mock('../../src/models/EmotionalCheckin', () => ({
  findById: jest.fn(),
  findOneAndUpdate: jest.fn()
}));

const EmotionalCheckin = require('../../src/models/EmotionalCheckin');
const notificationService = require('../../src/services/notificationService');

describe('Support request ownership and transition rules', () => {
  const requestId = '507f1f77bcf86cd799439011';
  const contactId = '507f1f77bcf86cd799439012';
  const mockFindByIdResult = (record) => {
    EmotionalCheckin.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue(record)
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('allows pending -> handled for assigned contact', async () => {
    mockFindByIdResult({
      supportContactUserId: { toString: () => contactId },
      supportContactResponse: { status: 'pending' }
    });
    EmotionalCheckin.findOneAndUpdate.mockResolvedValue({ _id: requestId });

    const result = await notificationService.confirmSupportRequest(requestId, contactId, 'handled', 'Handled safely');

    expect(result.success).toBe(true);
    expect(result.code).toBe(200);
    expect(EmotionalCheckin.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: requestId,
        supportContactUserId: contactId,
        'supportContactResponse.status': 'pending'
      }),
      expect.any(Object),
      { new: true }
    );
  });

  test('rejects confirmation from non-assigned contact', async () => {
    mockFindByIdResult({
      supportContactUserId: { toString: () => '507f1f77bcf86cd799439099' },
      supportContactResponse: { status: 'pending' }
    });

    const result = await notificationService.confirmSupportRequest(requestId, contactId, 'handled', 'Handled safely');

    expect(result.success).toBe(false);
    expect(result.code).toBe(403);
    expect(EmotionalCheckin.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('rejects invalid transition handled -> acknowledged', async () => {
    mockFindByIdResult({
      supportContactUserId: { toString: () => contactId },
      supportContactResponse: { status: 'handled' }
    });

    const result = await notificationService.confirmSupportRequest(requestId, contactId, 'acknowledged');

    expect(result.success).toBe(false);
    expect(result.code).toBe(409);
    expect(EmotionalCheckin.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

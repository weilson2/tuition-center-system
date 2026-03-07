import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import axios from 'axios';
import StorageTab from './StorageTab';

jest.mock('axios');

jest.mock('./FileDetailsModal', () => () => null);
jest.mock('./DownloadConfirmModal', () => () => null);
jest.mock('./AddToFolderModal', () => () => null);
jest.mock('./CreateFolderModal', () => () => null);
jest.mock('./BulkDeleteModal', () => () => null);
jest.mock('./FilePreviewModal', () => () => null);
jest.mock('./TextEditorModal', () => () => null);
jest.mock('./FileShareModal', () => ({ selectedFileIds }) => (
  <div data-testid="file-share-modal">Share Modal {selectedFileIds?.length || 0}</div>
));
jest.mock('./Toast', () => ({ message }) => (message ? <div data-testid="toast">{message}</div> : null));

const baseFile = {
  file_id: 1,
  original_filename: 'notes.txt',
  file_type: 'text/plain',
  file_size: 128,
  uploaded_at: '2026-03-01T09:00:00.000Z',
  total_share_count: 0,
  recipient_count: 0
};

const sharedFile = {
  file_id: 20,
  original_filename: 'shared.pdf',
  file_type: 'application/pdf',
  file_size: 2048,
  shared_at: '2026-03-01T10:00:00.000Z',
  sharer_name: 'Ms Tan',
  sharer_role: 'teacher'
};

const notifications = [
  {
    notification_id: 555,
    is_read: false,
    sharer_name: 'Ms Tan',
    sharer_role: 'teacher',
    file_count: 1,
    shared_at: '2026-03-01T10:00:00.000Z',
    files: [{ fileId: 20, fileName: 'shared.pdf' }]
  },
  {
    notification_id: 556,
    is_read: false,
    sharer_name: 'Mr Lim',
    sharer_role: 'teacher',
    file_count: 1,
    shared_at: '2026-03-01T11:00:00.000Z',
    files: [{ fileId: 21, fileName: 'worksheet.docx' }]
  }
];

const setupAxiosMocks = () => {
  axios.get.mockImplementation((url) => {
    if (url.includes('/storage/quota')) {
      return Promise.resolve({
        data: {
          used: 128,
          quota: 1024 * 1024,
          percentageUsed: '0.01',
          isUnlimited: false
        }
      });
    }

    if (url.includes('/storage/folders')) {
      return Promise.resolve({ data: { folders: [] } });
    }

    if (url.includes('/storage/files/shared')) {
      return Promise.resolve({ data: { files: [sharedFile] } });
    }

    if (url.includes('/storage/files')) {
      return Promise.resolve({ data: { files: [baseFile] } });
    }

    if (url.includes('/storage/notifications')) {
      return Promise.resolve({
        data: {
          notifications,
          unreadCount: notifications.filter((item) => !item.is_read).length,
          totalCount: notifications.length
        }
      });
    }

    return Promise.resolve({ data: {} });
  });

  axios.put.mockResolvedValue({ data: { message: 'ok' } });
  axios.post.mockResolvedValue({ data: { message: 'ok', addedCount: 1 } });
  axios.delete.mockResolvedValue({ data: { message: 'ok' } });
};

describe('StorageTab smoke tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupAxiosMocks();
    localStorage.setItem('token', 'smoke-token');
  });

  test('loads initial My Cloud Storage data', async () => {
    render(<StorageTab />);

    expect(await screen.findByText('notes.txt')).toBeInTheDocument();
    await waitFor(() => {
      expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/storage/quota'), expect.any(Object));
      expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/storage/files'), expect.any(Object));
    });
  });

  test('search all triggers cross-section fetch', async () => {
    render(<StorageTab />);
    await screen.findByText('notes.txt');

    fireEvent.click(screen.getByLabelText('Search All'));
    const searchInput = screen.getByPlaceholderText('Search files...');
    fireEvent.change(searchInput, { target: { value: 'notes' } });
    fireEvent.keyDown(searchInput, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      const sharedCalls = axios.get.mock.calls.filter(([url]) => String(url).includes('/storage/files/shared'));
      expect(sharedCalls.length).toBeGreaterThan(0);
    });
  });

  test('rename flow opens modal and calls rename API', async () => {
    const { container } = render(<StorageTab />);
    await screen.findByText('notes.txt');

    fireEvent.click(screen.getByTitle('Rename'));
    expect(await screen.findByText('Rename File')).toBeInTheDocument();

    const input = screen.getByPlaceholderText('Enter new filename');
    fireEvent.change(input, { target: { value: 'notes-updated' } });
    const modal = container.querySelector('.rename-file-modal');
    const submitButton = within(modal).getByRole('button', { name: /^Rename$/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      const renameCalls = axios.put.mock.calls.filter(([url]) => String(url).includes('/storage/files/1/rename'));
      expect(renameCalls.length).toBeGreaterThan(0);
    });
  });

  test('shared files tab shows notifications and marks read', async () => {
    render(<StorageTab />);

    fireEvent.click(screen.getByText('Shared Files'));

    fireEvent.click(await screen.findByRole('button', { name: /share notifications/i }));
    expect(await screen.findByText('shared.pdf')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: /mark as read/i })[0]);

    await waitFor(() => {
      const markReadCalls = axios.put.mock.calls.filter(([url]) => String(url).includes('/storage/notifications/555/read'));
      expect(markReadCalls.length).toBeGreaterThan(0);
    });
  });

  test('shared files tab supports mark all notifications as read', async () => {
    render(<StorageTab />);

    fireEvent.click(screen.getByText('Shared Files'));
    fireEvent.click(await screen.findByRole('button', { name: /share notifications/i }));

    fireEvent.click(screen.getByRole('button', { name: /mark all as read/i }));

    await waitFor(() => {
      const firstMarkReadCalls = axios.put.mock.calls.filter(([url]) => String(url).includes('/storage/notifications/555/read'));
      const secondMarkReadCalls = axios.put.mock.calls.filter(([url]) => String(url).includes('/storage/notifications/556/read'));
      expect(firstMarkReadCalls.length).toBeGreaterThan(0);
      expect(secondMarkReadCalls.length).toBeGreaterThan(0);
    });
  });

  test('selecting a file enables share action modal path', async () => {
    const { container } = render(<StorageTab />);
    await screen.findByText('notes.txt');

    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[1]);

    const shareButton = container.querySelector('.share-action-btn');
    expect(shareButton).toBeInTheDocument();
    fireEvent.click(shareButton);

    expect(await screen.findByTestId('file-share-modal')).toBeInTheDocument();
  });

  test('refresh button triggers data reload', async () => {
    render(<StorageTab />);
    await screen.findByText('notes.txt');

    const initialCalls = axios.get.mock.calls.length;
    fireEvent.click(screen.getByTitle('Refresh storage data'));

    await waitFor(() => {
      expect(axios.get.mock.calls.length).toBeGreaterThan(initialCalls);
    });
  });
});

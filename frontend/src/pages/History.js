import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Search, Download, Upload, Clock } from 'lucide-react';
import { toast } from 'sonner';

const History = () => {
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const [transfers, setTransfers] = useState([]);
  const [filteredTransfers, setFilteredTransfers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

  useEffect(() => {
    fetchTransfers();
  }, []);

  useEffect(() => {
    if (searchQuery.trim() === '') {
      setFilteredTransfers(transfers);
    } else {
      const filtered = transfers.filter(
        (t) =>
          t.fileName.toLowerCase().includes(searchQuery.toLowerCase()) ||
          t.sender_username.toLowerCase().includes(searchQuery.toLowerCase()) ||
          t.receiver_username.toLowerCase().includes(searchQuery.toLowerCase())
      );
      setFilteredTransfers(filtered);
    }
  }, [searchQuery, transfers]);

  const fetchTransfers = async () => {
    try {
      const response = await fetch(`${API}/transfers`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      setTransfers(data);
      setFilteredTransfers(data);
    } catch (error) {
      toast.error('Failed to fetch transfer history');
    } finally {
      setLoading(false);
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-cyan-50" data-testid="history-page">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center space-x-4">
            <Button
              variant="outline"
              size="sm"
              data-testid="back-to-dashboard-btn"
              onClick={() => navigate('/dashboard')}
              className="flex items-center space-x-2"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Dashboard</span>
            </Button>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Transfer History</h1>
              <p className="text-sm text-gray-600">View all your sent and received files</p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Card className="shadow-lg border-0">
          <CardHeader>
            <CardTitle>Transfer History</CardTitle>
            <div className="mt-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  data-testid="search-input"
                  type="text"
                  placeholder="Search by filename or username..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-12" data-testid="loading-message">
                <div className="animate-pulse">
                  <Clock className="w-12 h-12 mx-auto text-gray-300 mb-2" />
                  <p className="text-gray-500">Loading...</p>
                </div>
              </div>
            ) : filteredTransfers.length === 0 ? (
              <div className="text-center py-12" data-testid="no-transfers-message">
                <Clock className="w-12 h-12 mx-auto text-gray-300 mb-2" />
                <p className="text-gray-500">
                  {searchQuery ? 'No transfers found matching your search' : 'No transfer history yet'}
                </p>
              </div>
            ) : (
              <div className="space-y-3" data-testid="transfers-list">
                {filteredTransfers.map((transfer) => {
                  const isSender = transfer.sender_id === user?.id;
                  return (
                    <div
                      key={transfer.id}
                      data-testid={`transfer-item-${transfer.id}`}
                      className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                      <div className="flex items-center space-x-4 flex-1">
                        <div
                          className={`w-10 h-10 rounded-full flex items-center justify-center ${
                            isSender ? 'bg-blue-100' : 'bg-green-100'
                          }`}
                        >
                          {isSender ? (
                            <Upload className="w-5 h-5 text-blue-600" />
                          ) : (
                            <Download className="w-5 h-5 text-green-600" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 truncate" data-testid={`transfer-filename-${transfer.id}`}>
                            {transfer.fileName}
                          </p>
                          <p className="text-sm text-gray-600" data-testid={`transfer-details-${transfer.id}`}>
                            {isSender ? 'Sent to' : 'Received from'}{' '}
                            <span className="font-medium">
                              {isSender ? transfer.receiver_username : transfer.sender_username}
                            </span>{' '}
                            • {formatFileSize(transfer.fileSize)}
                          </p>
                        </div>
                      </div>
                      <div className="text-right text-sm text-gray-500">
                        <p data-testid={`transfer-date-${transfer.id}`}>{formatDate(transfer.timestamp)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default History;
import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useWebRTC } from '@/context/WebRTCContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  LogOut,
  History,
  Upload,
  Users,
  Send,
  Download,
} from 'lucide-react';
import { toast } from 'sonner';

// Add this component for the transfer dialog
const TransferDialog = ({ incomingTransfer, onAccept, onReject }) => {
  if (!incomingTransfer) return null;

  const fileSize = (incomingTransfer.fileSize / (1024 * 1024)).toFixed(2);

  return (
    <AlertDialog open={true}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Incoming File Transfer</AlertDialogTitle>
          <AlertDialogDescription>
            {incomingTransfer.from_username} wants to send you:
            <br />
            File: {incomingTransfer.fileName}
            <br />
            Size: {fileSize} MB
            <br />
            Type: {incomingTransfer.fileType}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onReject}>Reject</AlertDialogCancel>
          <AlertDialogAction onClick={onAccept}>Accept</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

const Dashboard = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
 const {
  onlineUsers = [],
  currentRoom,
  joinRoom = () => {},
  leaveRoom = () => {},
  sendFile = () => {},
  incomingTransfer = null,
  acceptTransfer = () => {},
  rejectTransfer = () => {},
  activeTransfer = null,
  downloadReceivedFile,
} = useWebRTC() || {};


  const [selectedFile, setSelectedFile] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [roomInput, setRoomInput] = useState(''); // 🆕 Room input field
  const [showRoomDialog, setShowRoomDialog] = useState(true); // 🆕 Room dialog toggle
  const [transfers, setTransfers] = useState([]);
  const fileInputRef = useRef(null);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setSelectedFile(e.dataTransfer.files[0]);
      toast.success('File selected!');
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
      toast.success('File selected!');
    }
  };

  const handleSendFile = (targetUser) => {
    if (!selectedFile) {
      toast.error('Please select a file first');
      return;
    }
    sendFile(selectedFile, targetUser.id);
    toast.info(`Sending transfer request to ${targetUser.username}...`);
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  // 🆕 Handle joining and leaving rooms
  const handleJoinRoom = () => {
    if (!roomInput.trim()) {
      toast.error('Please enter a valid room ID');
      return;
    }
    joinRoom(roomInput.trim());
    setShowRoomDialog(false);
    toast.success(`Joined room: ${roomInput.trim()}`);
  };

  const handleLeaveRoom = () => {
    leaveRoom();
    setShowRoomDialog(true);
    toast('Left the room');
  };

  // Add these handlers
  const handleAcceptTransfer = () => {
    acceptTransfer();
    toast.success('Transfer accepted');
  };

  const handleRejectTransfer = () => {
    rejectTransfer();
    toast.error('Transfer rejected');
  };

  // Add function to fetch transfer history
  const fetchTransfers = async () => {
    try {
      const response = await fetch('http://127.0.0.1:8000/api/transfers', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await response.json();
      setTransfers(data);
    } catch (error) {
      toast.error('Failed to load transfer history');
    }
  };

  // Add useEffect to load transfers on mount
  useEffect(() => {
    fetchTransfers();
  }, []);

  return (
    <div
      className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-cyan-50"
      data-testid="dashboard-page"
    >
      {/* 🆕 ROOM JOIN DIALOG */}
      {showRoomDialog && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-50">
          <div className="bg-white p-6 rounded-xl shadow-lg space-y-4 w-80">
            <h2 className="text-lg font-semibold text-gray-800 text-center">
              Join a Room
            </h2>
            <p className="text-sm text-gray-500 text-center">
              Enter a room name to connect with others
            </p>
            <Input
              value={roomInput}
              onChange={(e) => setRoomInput(e.target.value)}
              placeholder="e.g., project-room-1"
            />
            <div className="flex justify-end space-x-2">
              <Button
                variant="outline"
                onClick={() => setShowRoomDialog(false)}
              >
                Cancel
              </Button>
              <Button onClick={handleJoinRoom}>Join</Button>
            </div>
          </div>
        </div>
      )}

      {/* Show rest of dashboard only after joining */}
      {!showRoomDialog && (
        <>
          {/* Header */}
          <header className="bg-white/80 backdrop-blur-md border-b border-gray-200 sticky top-0 z-10">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
              <div className="flex justify-between items-center">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-lg flex items-center justify-center">
                    <Send className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h1 className="text-xl font-bold text-gray-900">
                      P2P File Share
                    </h1>
                    <p className="text-sm text-gray-600">
                      Welcome, {user?.username}
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate('/history')}
                    className="flex items-center space-x-2"
                  >
                    <History className="w-4 h-4" />
                    <span className="hidden sm:inline">History</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      logout();
                      navigate('/');
                      toast.success('Logged out successfully');
                    }}
                    className="flex items-center space-x-2"
                  >
                    <LogOut className="w-4 h-4" />
                    <span className="hidden sm:inline">Logout</span>
                  </Button>
                </div>
              </div>
            </div>
          </header>

          {/* Main Content */}
          <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="grid lg:grid-cols-3 gap-6">
              {/* File Upload Section */}
              <div className="lg:col-span-2 space-y-6">
                <Card className="shadow-lg border-0">
                  <CardHeader>
                    <CardTitle className="flex items-center space-x-2">
                      <Upload className="w-5 h-5" />
                      <span>Select File to Share</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div
                      className={`border-2 border-dashed rounded-lg p-8 text-center transition-all ${
                        dragActive
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-300 hover:border-gray-400'
                      }`}
                      onDragEnter={handleDrag}
                      onDragLeave={handleDrag}
                      onDragOver={handleDrag}
                      onDrop={handleDrop}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        onChange={handleFileChange}
                        className="hidden"
                      />
                      <Upload className="w-12 h-12 mx-auto text-gray-400 mb-4" />
                      {selectedFile ? (
                        <div className="space-y-2">
                          <p className="text-lg font-semibold text-gray-900">
                            {selectedFile.name}
                          </p>
                          <p className="text-sm text-gray-600">
                            {formatFileSize(selectedFile.size)}
                          </p>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedFile(null);
                            }}
                            className="mt-2"
                          >
                            Change File
                          </Button>
                        </div>
                      ) : (
                        <div>
                          <p className="text-gray-600 mb-2">
                            Drag and drop a file here, or click to browse
                          </p>
                          <p className="text-sm text-gray-500">
                            Any file size supported
                          </p>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Active Transfer Progress */}
                {activeTransfer && (
                  <Card className="shadow-lg border-0 bg-gradient-to-r from-blue-50 to-cyan-50">
                    <CardHeader>
                      <CardTitle className="text-lg">
                        {activeTransfer.type === 'sending'
                          ? 'Sending File...'
                          : 'Receiving File...'}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div>
                        <div className="flex justify-between text-sm mb-2">
                          <span className="font-medium">
                            {activeTransfer.fileName}
                          </span>
                          <span className="text-gray-600">
                            {Math.round(activeTransfer.progress)}%
                          </span>
                        </div>
                        <Progress value={activeTransfer.progress} className="h-2" />
                      </div>
                      <p className="text-sm text-gray-600">
                        {formatFileSize(activeTransfer.fileSize)}
                      </p>
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* Online Users Section */}
              <div>
                <Card className="shadow-lg border-0">
                  <CardHeader>
                    <CardTitle className="flex items-center space-x-2">
                      <Users className="w-5 h-5" />
                      <span>Online Users ({onlineUsers.length})</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {onlineUsers.length === 0 ? (
                      <div className="text-center py-8">
                        <Users className="w-12 h-12 mx-auto text-gray-300 mb-2" />
                        <p className="text-gray-500">No users online</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {onlineUsers.map((onlineUser) => (
                          <div
                            key={onlineUser.id}
                            className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                          >
                            <div className="flex items-center space-x-3">
                              <div className="w-10 h-10 bg-gradient-to-br from-green-400 to-blue-500 rounded-full flex items-center justify-center text-white font-semibold">
                                {onlineUser.username.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <p className="font-medium text-gray-900">
                                  {onlineUser.username}
                                </p>
                                <div className="flex items-center space-x-1">
                                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                                  <span className="text-xs text-gray-500">
                                    Online
                                  </span>
                                </div>
                              </div>
                            </div>
                            <Button
                              size="sm"
                              onClick={() => handleSendFile(onlineUser)}
                              disabled={!selectedFile || activeTransfer}
                              className="flex items-center space-x-1"
                            >
                              <Send className="w-3 h-3" />
                              <span>Send</span>
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
            {/* Leave Room Button */}
            <div className="text-center mt-6">
              <Button variant="outline" onClick={handleLeaveRoom}>
                Leave Room
              </Button>
            </div>
          </main>

          {/* Incoming Transfer Dialog */}
          <TransferDialog 
        incomingTransfer={incomingTransfer}
        onAccept={handleAcceptTransfer}
        onReject={handleRejectTransfer}
      />

          {/* Add Transfer History Section */}
          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5" />
                Transfer History
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {transfers.map((transfer) => (
                  <div 
                    key={transfer.id} 
                    className="border p-4 rounded-lg hover:bg-muted transition-colors"
                  >
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="font-medium">{transfer.fileName}</p>
                        <p className="text-sm text-muted-foreground">
                          {transfer.sender_id === user.id ? 'Sent to' : 'Received from'}: {
                            transfer.sender_id === user.id ? transfer.receiver_username : transfer.sender_username
                          }
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Size: {(transfer.fileSize / (1024 * 1024)).toFixed(2)} MB
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <p className="text-sm text-muted-foreground">
                          {new Date(transfer.timestamp).toLocaleDateString()}
                        </p>
                        {transfer.receiver_id === user.id && transfer.status === 'completed' && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex items-center gap-2"
                            onClick={() => downloadReceivedFile(transfer.id)}
                          >
                            <Download className="h-4 w-4" />
                            Download
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

export default Dashboard;

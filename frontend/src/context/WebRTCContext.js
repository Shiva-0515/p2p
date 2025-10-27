import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { toast } from 'sonner';

const WebRTCContext = createContext();

const CHUNK_SIZE = 16384; // 16KB chunks

export const WebRTCProvider = ({ children }) => {
  const { token, user } = useAuth();
  const [ws, setWs] = useState(null);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [currentRoom, setCurrentRoom] = useState(null);
  const [incomingTransfer, setIncomingTransfer] = useState(null);
  const [activeTransfer, setActiveTransfer] = useState(null);
  
  const peerConnectionRef = useRef(null);
  const dataChannelRef = useRef(null);
  const fileReaderRef = useRef(null);
  const receivedBufferRef = useRef([]);
  const receivedSizeRef = useRef(0);
  const transferMetaRef = useRef(null);

  useEffect(() => {
    let socket = null;
    
    if (token && user) {
      socket = connectWebSocket();
    }
    
    return () => {
      if (socket) {
        socket.close();
      }
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }
    };
  }, [token, user]);

  const connectWebSocket = () => {
    const backend = process.env.REACT_APP_BACKEND_URL || 'http://127.0.0.1:8000';
    const wsUrl = backend.startsWith('https://')
      ? backend.replace('https://', 'wss://')
      : backend.startsWith('http://')
        ? backend.replace('http://', 'ws://')
        : backend;
    const socket = new WebSocket(`${wsUrl.replace(/\/+$/, '')}/api/ws/${encodeURIComponent(token)}`);

    socket.onopen = () => {
      console.log('WebSocket connected successfully');
      setWs(socket);
    };

    socket.onmessage = async (event) => {
      const message = JSON.parse(event.data);
      console.log('WebSocket message received:', message);

      switch (message.type) {
        case 'room_users':
          setOnlineUsers(message.users.filter(u => u.id !== user.id));
          break;
        case 'room_joined':
          setCurrentRoom(message.room_id);
          toast.success(`Joined room: ${message.room_id}`);
          break;
        case 'room_left':
          setCurrentRoom(null);
          setOnlineUsers([]);
          toast.info('Left the room');
          break;
        case 'transfer-request':
          setIncomingTransfer({
            from: message.from,
            from_username: message.from_username,
            fileName: message.fileName,
            fileSize: message.fileSize,
            fileType: message.fileType,
          });
          break;
        case 'transfer-response':
          if (message.accepted) {
            await createOffer(message.from);
          } else {
            toast.error('Transfer rejected by recipient');
            setActiveTransfer(null);
          }
          break;
        case 'offer':
          await handleOffer(message);
          break;
        case 'answer':
          await handleAnswer(message);
          break;
        case 'ice-candidate':
          await handleIceCandidate(message);
          break;
      }
    };

    socket.onerror = (error) => {
      console.error('WebSocket error:', error);
      toast.error('Connection error');
    };

    socket.onclose = () => {
      console.log('WebSocket disconnected');
      setWs(null);
    };
    
    return socket;
  };

  const joinRoom = (roomId) => {
    if (ws && roomId) {
      ws.send(JSON.stringify({
        type: 'join_room',
        room_id: roomId,
      }));
    }
  };

  const leaveRoom = () => {
    if (ws) {
      ws.send(JSON.stringify({
        type: 'leave_room',
      }));
    }
  };

  const createPeerConnection = (targetUserId) => {
    const config = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    };

    const pc = new RTCPeerConnection(config);
    peerConnectionRef.current = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate && ws) {
        ws.send(JSON.stringify({
          type: 'ice-candidate',
          target: targetUserId,
          candidate: event.candidate,
        }));
      }
    };

    pc.ondatachannel = (event) => {
      const channel = event.channel;
      dataChannelRef.current = channel;
      setupDataChannel(channel);
    };

    return pc;
  };

  const setupDataChannel = (channel) => {
    channel.onopen = () => {
      console.log('Data channel opened');
    };

    channel.onmessage = async (event) => {
      if (typeof event.data === 'string') {
        // Metadata or control message
        const message = JSON.parse(event.data);
        if (message.type === 'file-meta') {
          transferMetaRef.current = message;
          receivedBufferRef.current = [];
          receivedSizeRef.current = 0;
          setActiveTransfer({
            fileName: message.fileName,
            fileSize: message.fileSize,
            progress: 0,
            type: 'receiving',
          });
        } else if (message.type === 'file-end') {
          // File transfer complete
          const blob = new Blob(receivedBufferRef.current, { type: transferMetaRef.current.fileType });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = transferMetaRef.current.fileName;
          a.click();
          URL.revokeObjectURL(url);

          toast.success('File received successfully!');
          setActiveTransfer(null);

          // Log transfer
          await logTransfer({
            fileName: transferMetaRef.current.fileName,
            fileSize: transferMetaRef.current.fileSize,
            fileType: transferMetaRef.current.fileType,
            sender_id: transferMetaRef.current.senderId,
            receiver_id: user.id,
          });
        }
      } else {
        // Binary data (file chunk)
        receivedBufferRef.current.push(event.data);
        receivedSizeRef.current += event.data.byteLength;
        
        const progress = (receivedSizeRef.current / transferMetaRef.current.fileSize) * 100;
        setActiveTransfer(prev => ({
          ...prev,
          progress: Math.min(progress, 100),
        }));
      }
    };

    channel.onclose = () => {
      console.log('Data channel closed');
    };
  };

  const createOffer = async (targetUserId) => {
    const pc = createPeerConnection(targetUserId);
    const channel = pc.createDataChannel('fileTransfer');
    dataChannelRef.current = channel;
    setupDataChannel(channel);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    ws.send(JSON.stringify({
      type: 'offer',
      target: targetUserId,
      offer: offer,
    }));
  };

  const handleOffer = async (message) => {
    const pc = createPeerConnection(message.from);
    await pc.setRemoteDescription(new RTCSessionDescription(message.offer));

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    ws.send(JSON.stringify({
      type: 'answer',
      target: message.from,
      answer: answer,
    }));
  };

  const handleAnswer = async (message) => {
    await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(message.answer));
  };

  const handleIceCandidate = async (message) => {
    if (peerConnectionRef.current && message.candidate) {
      await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(message.candidate));
    }
  };

  const sendFile = async (file, targetUserId) => {
    if (!ws || !file) return;

    // Send transfer request
    ws.send(JSON.stringify({
      type: 'transfer-request',
      target: targetUserId,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
    }));

    setActiveTransfer({
      fileName: file.name,
      fileSize: file.size,
      progress: 0,
      type: 'sending',
      file: file,
      targetUserId: targetUserId,
    });
  };

  const startFileTransfer = async () => {
    if (!activeTransfer || !activeTransfer.file || !dataChannelRef.current) return;
 
    const { file, targetUserId } = activeTransfer;
 
    // Wait for data channel to be open (with timeout)
    if (dataChannelRef.current.readyState !== 'open') {
      try {
        await new Promise((resolve, reject) => {
          const onOpen = () => {
            try {
              dataChannelRef.current.removeEventListener?.('open', onOpen);
            } catch {}
            resolve();
          };
          // Prefer addEventListener if available, fallback to onopen
          if (dataChannelRef.current.addEventListener) {
            dataChannelRef.current.addEventListener('open', onOpen);
          } else {
            dataChannelRef.current.onopen = onOpen;
          }
          setTimeout(() => reject(new Error('Data channel open timeout')), 20000);
        });
      } catch (err) {
        toast.error('Data channel failed to open');
        console.error(err);
        return; // abort transfer
      }
    }

    // Send file metadata
    dataChannelRef.current.send(JSON.stringify({
      type: 'file-meta',
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      senderId: user.id,
    }));

    // Send file in chunks
    let offset = 0;
    const reader = new FileReader();

    reader.onload = (e) => {
      dataChannelRef.current.send(e.target.result);
      offset += e.target.result.byteLength;
      
      const progress = (offset / file.size) * 100;
      setActiveTransfer(prev => ({
        ...prev,
        progress: Math.min(progress, 100),
      }));

      if (offset < file.size) {
        readSlice(offset);
      } else {
        // File transfer complete
        dataChannelRef.current.send(JSON.stringify({ type: 'file-end' }));
        toast.success('File sent successfully!');
        
        // Log transfer
        logTransfer({
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
          sender_id: user.id,
          receiver_id: targetUserId,
        });

        setTimeout(() => setActiveTransfer(null), 2000);
      }
    };

    const readSlice = (o) => {
      const slice = file.slice(o, o + CHUNK_SIZE);
      reader.readAsArrayBuffer(slice);
    };

    readSlice(0);
  };

  const acceptTransfer = async () => {
    if (!incomingTransfer || !ws) return;

    ws.send(JSON.stringify({
      type: 'transfer-response',
      target: incomingTransfer.from,
      accepted: true,
    }));

    setIncomingTransfer(null);
  };

  const rejectTransfer = () => {
    if (!incomingTransfer || !ws) return;

    ws.send(JSON.stringify({
      type: 'transfer-response',
      target: incomingTransfer.from,
      accepted: false,
    }));

    setIncomingTransfer(null);
  };

  const logTransfer = async (transferData) => {
    try {
      const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
      await fetch(`${API}/transfers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(transferData),
      });
    } catch (error) {
      console.error('Failed to log transfer:', error);
    }
  };

  useEffect(() => {
    if (activeTransfer && activeTransfer.type === 'sending' && activeTransfer.progress === 0 && dataChannelRef.current) {
      startFileTransfer();
    }
  }, [activeTransfer, dataChannelRef.current]);

  return (
    <WebRTCContext.Provider
      value={{
        onlineUsers,
        currentRoom,
        joinRoom,
        leaveRoom,
        sendFile,
        incomingTransfer,
        acceptTransfer,
        rejectTransfer,
        activeTransfer,
      }}
    >
      {children}
    </WebRTCContext.Provider>
  );
};

export const useWebRTC = () => useContext(WebRTCContext);
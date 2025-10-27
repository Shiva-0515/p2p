from fastapi import FastAPI, APIRouter, HTTPException, WebSocket, WebSocketDisconnect, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict, EmailStr
from typing import List, Optional, Dict
import uuid
from datetime import datetime, timezone, timedelta
from passlib.context import CryptContext
from jose import JWTError, jwt
import json

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Security
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()
SECRET_KEY = os.environ.get('SECRET_KEY', 'your-secret-key-change-in-production')
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days

app = FastAPI()
api_router = APIRouter(prefix="/api")

# Enable CORS for frontend dev at localhost:3000
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# WebSocket connection manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}  # user_id -> websocket
        self.user_info: Dict[str, dict] = {}  # user_id -> {username, email, room_id}
        self.rooms: Dict[str, set] = {}  # room_id -> set of user_ids

    async def connect(self, user_id: str, username: str, email: str, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[user_id] = websocket
        self.user_info[user_id] = {"username": username, "email": email, "room_id": None}

    async def join_room(self, user_id: str, room_id: str):
        # Leave current room if in one
        if user_id in self.user_info and self.user_info[user_id]["room_id"]:
            await self.leave_room(user_id)
        
        # Join new room
        if room_id not in self.rooms:
            self.rooms[room_id] = set()
        self.rooms[room_id].add(user_id)
        self.user_info[user_id]["room_id"] = room_id
        
        # Broadcast to room
        await self.broadcast_room_users(room_id)

    async def leave_room(self, user_id: str):
        if user_id not in self.user_info:
            return
        
        room_id = self.user_info[user_id]["room_id"]
        if room_id and room_id in self.rooms:
            self.rooms[room_id].discard(user_id)
            if len(self.rooms[room_id]) == 0:
                del self.rooms[room_id]
            else:
                await self.broadcast_room_users(room_id)
        
        self.user_info[user_id]["room_id"] = None

    async def disconnect(self, user_id: str):
        await self.leave_room(user_id)
        if user_id in self.active_connections:
            del self.active_connections[user_id]
        if user_id in self.user_info:
            del self.user_info[user_id]

    async def send_personal_message(self, message: dict, user_id: str):
        ws = self.active_connections.get(user_id)
        if not ws:
            return
        try:
            await ws.send_json(message)
        except Exception:
            # connection likely closed — perform cleanup
            try:
                await self.disconnect(user_id)
            except Exception:
                pass

    async def broadcast_room_users(self, room_id: str):
        if room_id not in self.rooms:
            return
        
        room_users = []
        for user_id in self.rooms[room_id]:
            if user_id in self.user_info:
                info = self.user_info[user_id]
                room_users.append({
                    "id": user_id,
                    "username": info["username"],
                    "email": info["email"]
                })
        
        message = {"type": "room_users", "users": room_users, "room_id": room_id}
        for user_id in self.rooms[room_id]:
            if user_id in self.active_connections:
                try:
                    await self.active_connections[user_id].send_json(message)
                except:
                    pass

manager = ConnectionManager()

# Pydantic Models
class UserRegister(BaseModel):
    username: str
    email: EmailStr
    password: str

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class ForgotPassword(BaseModel):
    email: EmailStr

class ResetPassword(BaseModel):
    email: EmailStr
    reset_code: str
    new_password: str

class User(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    username: str
    email: str
    created_at: datetime

class Token(BaseModel):
    access_token: str
    token_type: str
    user: User

class TransferHistoryCreate(BaseModel):
    fileName: str
    fileSize: int
    fileType: str
    sender_id: str
    receiver_id: str

class TransferHistory(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    fileName: str
    fileSize: int
    fileType: str
    sender_id: str
    receiver_id: str
    sender_username: Optional[str] = None
    receiver_username: Optional[str] = None
    timestamp: datetime

# Helper functions
def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    try:
        token = credentials.credentials
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid authentication credentials")
        
        user = await db.users.find_one({"id": user_id}, {"_id": 0})
        if user is None:
            raise HTTPException(status_code=401, detail="User not found")
        return user
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid authentication credentials")

# Auth routes
@api_router.post("/auth/register", response_model=Token)
async def register(user_data: UserRegister):
    # Check if user already exists
    existing_user = await db.users.find_one({"$or": [{"email": user_data.email}, {"username": user_data.username}]})
    if existing_user:
        raise HTTPException(status_code=400, detail="User with this email or username already exists")
    
    # Create user
    user_id = str(uuid.uuid4())
    user_doc = {
        "id": user_id,
        "username": user_data.username,
        "email": user_data.email,
        "password": hash_password(user_data.password),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "reset_code": None
    }
    await db.users.insert_one(user_doc)
    
    # Create token
    access_token = create_access_token(data={"sub": user_id})
    user = User(
        id=user_id,
        username=user_data.username,
        email=user_data.email,
        created_at=datetime.now(timezone.utc)
    )
    return Token(access_token=access_token, token_type="bearer", user=user)

@api_router.post("/auth/login", response_model=Token)
async def login(user_data: UserLogin):
    user = await db.users.find_one({"email": user_data.email})
    if not user or not verify_password(user_data.password, user["password"]):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    
    access_token = create_access_token(data={"sub": user["id"]})
    user_obj = User(
        id=user["id"],
        username=user["username"],
        email=user["email"],
        created_at=datetime.fromisoformat(user["created_at"])
    )
    return Token(access_token=access_token, token_type="bearer", user=user_obj)

@api_router.post("/auth/forgot-password")
async def forgot_password(data: ForgotPassword):
    user = await db.users.find_one({"email": data.email})
    if not user:
        # For security, don't reveal if email exists
        return {"message": "If the email exists, a reset code has been sent"}
    
    # Generate 6-digit reset code
    reset_code = str(uuid.uuid4())[:6].upper()
    await db.users.update_one(
        {"email": data.email},
        {"$set": {"reset_code": reset_code}}
    )
    
    # In production, send this via email. For now, return it (demo purposes)
    return {"message": "Reset code generated", "reset_code": reset_code, "email": data.email}

@api_router.post("/auth/reset-password")
async def reset_password(data: ResetPassword):
    user = await db.users.find_one({"email": data.email, "reset_code": data.reset_code})
    if not user:
        raise HTTPException(status_code=400, detail="Invalid reset code or email")
    
    # Update password and clear reset code
    await db.users.update_one(
        {"email": data.email},
        {"$set": {"password": hash_password(data.new_password), "reset_code": None}}
    )
    
    return {"message": "Password reset successfully"}

@api_router.get("/auth/me", response_model=User)
async def get_me(current_user: dict = Depends(get_current_user)):
    return User(
        id=current_user["id"],
        username=current_user["username"],
        email=current_user["email"],
        created_at=datetime.fromisoformat(current_user["created_at"])
    )

# Transfer history routes
@api_router.post("/transfers")
async def create_transfer(transfer: TransferHistoryCreate, current_user: dict = Depends(get_current_user)):
    transfer_id = str(uuid.uuid4())
    
    # Get sender and receiver usernames
    sender = await db.users.find_one({"id": transfer.sender_id}, {"username": 1})
    receiver = await db.users.find_one({"id": transfer.receiver_id}, {"username": 1})
    
    transfer_doc = {
        "id": transfer_id,
        "fileName": transfer.fileName,
        "fileSize": transfer.fileSize,
        "fileType": transfer.fileType,
        "sender_id": transfer.sender_id,
        "receiver_id": transfer.receiver_id,
        "sender_username": sender["username"] if sender else "Unknown",
        "receiver_username": receiver["username"] if receiver else "Unknown",
        "timestamp": datetime.now(timezone.utc).isoformat()
    }
    await db.transfer_history.insert_one(transfer_doc)
    return {"message": "Transfer logged successfully", "id": transfer_id}

@api_router.get("/transfers", response_model=List[TransferHistory])
async def get_transfers(current_user: dict = Depends(get_current_user)):
    transfers = await db.transfer_history.find(
        {"$or": [{"sender_id": current_user["id"]}, {"receiver_id": current_user["id"]}]},
        {"_id": 0}
    ).sort("timestamp", -1).to_list(1000)
    
    for transfer in transfers:
        if isinstance(transfer['timestamp'], str):
            transfer['timestamp'] = datetime.fromisoformat(transfer['timestamp'])
    
    return transfers

@api_router.get("/transfers/search")
async def search_transfers(q: str, current_user: dict = Depends(get_current_user)):
    query = {
        "$and": [
            {"$or": [{"sender_id": current_user["id"]}, {"receiver_id": current_user["id"]}]},
            {"$or": [
                {"fileName": {"$regex": q, "$options": "i"}},
                {"sender_username": {"$regex": q, "$options": "i"}},
                {"receiver_username": {"$regex": q, "$options": "i"}}
            ]}
        ]
    }
    
    transfers = await db.transfer_history.find(query, {"_id": 0}).sort("timestamp", -1).to_list(1000)
    
    for transfer in transfers:
        if isinstance(transfer['timestamp'], str):
            transfer['timestamp'] = datetime.fromisoformat(transfer['timestamp'])
    
    return transfers

# WebSocket for signaling
@app.websocket("/api/ws/{token}")
async def websocket_endpoint(websocket: WebSocket, token: str):
    user_id = None
    try:
        # Verify token
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            await websocket.close(code=4001)
            return

        user = await db.users.find_one({"id": user_id})
        if not user:
            await websocket.close(code=4001)
            return

        await manager.connect(user_id, user["username"], user["email"], websocket)

        try:
            while True:
                data = await websocket.receive_text()
                message = json.loads(data)
                mtype = message.get("type")

                # Handle room join/leave
                if mtype == "join_room":
                    room_id = message.get("room_id")
                    if room_id:
                        await manager.join_room(user_id, room_id)
                        await manager.send_personal_message({
                            "type": "room_joined",
                            "room_id": room_id
                        }, user_id)

                elif mtype == "leave_room":
                    await manager.leave_room(user_id)
                    await manager.send_personal_message({
                        "type": "room_left"
                    }, user_id)

                # Relay signaling messages
                elif mtype in ["offer", "answer", "ice-candidate"]:
                    target_id = message.get("target")
                    if target_id:
                        payload = dict(message)  # copy to avoid mutating original
                        payload.update({"from": user_id, "from_username": user["username"]})
                        # remove target before sending so receiver gets only relevant fields
                        payload.pop("target", None)
                        await manager.send_personal_message(payload, target_id)

                elif mtype == "transfer-request":
                    target_id = message.get("target")
                    if target_id:
                        await manager.send_personal_message({
                            "type": "transfer-request",
                            "from": user_id,
                            "from_username": user["username"],
                            "fileName": message.get("fileName"),
                            "fileSize": message.get("fileSize"),
                            "fileType": message.get("fileType")
                        }, target_id)

                elif mtype == "transfer-response":
                    target_id = message.get("target")
                    if target_id:
                        await manager.send_personal_message({
                            "type": "transfer-response",
                            "from": user_id,
                            "accepted": message.get("accepted", False)
                        }, target_id)

        except WebSocketDisconnect:
            # client disconnected
            await manager.disconnect(user_id)

    except JWTError:
        await websocket.close(code=4001)
    except Exception as e:
        logging.error(f"WebSocket error: {e}")
        if user_id:
            try:
                await manager.disconnect(user_id)
            except Exception:
                pass

# Include the API router
app.include_router(api_router)

# This should be at the end of the file
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)

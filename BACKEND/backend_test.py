import requests
import sys
import json
from datetime import datetime

class P2PFileShareAPITester:
    def __init__(self, base_url="https://p2pshare-1.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.token = None
        self.user_id = None
        self.tests_run = 0
        self.tests_passed = 0
        self.test_results = []

    def log_test(self, name, success, details=""):
        """Log test result"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {name} - PASSED")
        else:
            print(f"❌ {name} - FAILED: {details}")
        
        self.test_results.append({
            "test": name,
            "success": success,
            "details": details
        })

    def run_test(self, name, method, endpoint, expected_status, data=None, headers=None):
        """Run a single API test"""
        url = f"{self.base_url}/{endpoint}"
        test_headers = {'Content-Type': 'application/json'}
        
        if self.token:
            test_headers['Authorization'] = f'Bearer {self.token}'
        
        if headers:
            test_headers.update(headers)

        print(f"\n🔍 Testing {name}...")
        print(f"   URL: {url}")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=test_headers, timeout=10)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=test_headers, timeout=10)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=test_headers, timeout=10)
            elif method == 'DELETE':
                response = requests.delete(url, headers=test_headers, timeout=10)

            success = response.status_code == expected_status
            
            if success:
                self.log_test(name, True)
                try:
                    return True, response.json()
                except:
                    return True, response.text
            else:
                error_msg = f"Expected {expected_status}, got {response.status_code}"
                try:
                    error_detail = response.json()
                    error_msg += f" - {error_detail}"
                except:
                    error_msg += f" - {response.text}"
                self.log_test(name, False, error_msg)
                return False, {}

        except requests.exceptions.RequestException as e:
            self.log_test(name, False, f"Request error: {str(e)}")
            return False, {}
        except Exception as e:
            self.log_test(name, False, f"Unexpected error: {str(e)}")
            return False, {}

    def test_user_registration(self):
        """Test user registration"""
        timestamp = datetime.now().strftime('%H%M%S')
        test_data = {
            "username": f"testuser_{timestamp}",
            "email": f"test_{timestamp}@example.com",
            "password": "TestPass123!"
        }
        
        success, response = self.run_test(
            "User Registration",
            "POST",
            "auth/register",
            200,
            data=test_data
        )
        
        if success and 'access_token' in response:
            self.token = response['access_token']
            self.user_id = response['user']['id']
            self.test_email = test_data['email']
            self.test_password = test_data['password']
            return True
        return False

    def test_user_login(self):
        """Test user login with registered credentials"""
        if not hasattr(self, 'test_email'):
            self.log_test("User Login", False, "No test user created for login")
            return False
            
        login_data = {
            "email": self.test_email,
            "password": self.test_password
        }
        
        success, response = self.run_test(
            "User Login",
            "POST",
            "auth/login",
            200,
            data=login_data
        )
        
        if success and 'access_token' in response:
            self.token = response['access_token']
            return True
        return False

    def test_get_current_user(self):
        """Test getting current user info"""
        success, response = self.run_test(
            "Get Current User",
            "GET",
            "auth/me",
            200
        )
        return success

    def test_forgot_password(self):
        """Test forgot password flow"""
        if not hasattr(self, 'test_email'):
            self.log_test("Forgot Password", False, "No test user email available")
            return False
            
        forgot_data = {"email": self.test_email}
        
        success, response = self.run_test(
            "Forgot Password",
            "POST",
            "auth/forgot-password",
            200,
            data=forgot_data
        )
        
        if success and 'reset_code' in response:
            self.reset_code = response['reset_code']
            return True
        return False

    def test_reset_password(self):
        """Test password reset"""
        if not hasattr(self, 'reset_code') or not hasattr(self, 'test_email'):
            self.log_test("Reset Password", False, "No reset code or email available")
            return False
            
        reset_data = {
            "email": self.test_email,
            "reset_code": self.reset_code,
            "new_password": "NewTestPass123!"
        }
        
        success, response = self.run_test(
            "Reset Password",
            "POST",
            "auth/reset-password",
            200,
            data=reset_data
        )
        
        if success:
            # Update password for future tests
            self.test_password = "NewTestPass123!"
        
        return success

    def test_create_transfer_history(self):
        """Test creating transfer history entry"""
        if not self.user_id:
            self.log_test("Create Transfer History", False, "No user ID available")
            return False
            
        transfer_data = {
            "fileName": "test_file.txt",
            "fileSize": 1024,
            "fileType": "text/plain",
            "sender_id": self.user_id,
            "receiver_id": "dummy_receiver_id"
        }
        
        success, response = self.run_test(
            "Create Transfer History",
            "POST",
            "transfers",
            200,
            data=transfer_data
        )
        
        if success and 'id' in response:
            self.transfer_id = response['id']
            return True
        return False

    def test_get_transfers(self):
        """Test getting transfer history"""
        success, response = self.run_test(
            "Get Transfer History",
            "GET",
            "transfers",
            200
        )
        return success

    def test_search_transfers(self):
        """Test searching transfer history"""
        success, response = self.run_test(
            "Search Transfer History",
            "GET",
            "transfers/search?q=test",
            200
        )
        return success

    def test_invalid_login(self):
        """Test login with invalid credentials"""
        invalid_data = {
            "email": "invalid@example.com",
            "password": "wrongpassword"
        }
        
        success, response = self.run_test(
            "Invalid Login (Should Fail)",
            "POST",
            "auth/login",
            401,
            data=invalid_data
        )
        return success

    def test_unauthorized_access(self):
        """Test accessing protected endpoint without token"""
        # Temporarily remove token
        original_token = self.token
        self.token = None
        
        success, response = self.run_test(
            "Unauthorized Access (Should Fail)",
            "GET",
            "auth/me",
            401
        )
        
        # Restore token
        self.token = original_token
        return success

    def run_all_tests(self):
        """Run all API tests"""
        print("🚀 Starting P2P File Share API Tests")
        print("=" * 50)
        
        # Test sequence
        tests = [
            self.test_user_registration,
            self.test_user_login,
            self.test_get_current_user,
            self.test_forgot_password,
            self.test_reset_password,
            self.test_create_transfer_history,
            self.test_get_transfers,
            self.test_search_transfers,
            self.test_invalid_login,
            self.test_unauthorized_access
        ]
        
        for test in tests:
            try:
                test()
            except Exception as e:
                self.log_test(test.__name__, False, f"Exception: {str(e)}")
        
        # Print summary
        print("\n" + "=" * 50)
        print(f"📊 Test Summary: {self.tests_passed}/{self.tests_run} tests passed")
        print(f"Success Rate: {(self.tests_passed/self.tests_run)*100:.1f}%")
        
        if self.tests_passed == self.tests_run:
            print("🎉 All tests passed!")
            return 0
        else:
            print("⚠️  Some tests failed. Check the details above.")
            return 1

def main():
    tester = P2PFileShareAPITester()
    return tester.run_all_tests()

if __name__ == "__main__":
    sys.exit(main())
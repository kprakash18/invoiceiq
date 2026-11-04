import os

from dotenv import load_dotenv
from google import genai


# Load environment variables
load_dotenv()

# Read configuration
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = os.getenv(
    "GEMINI_MODEL",
    "gemini-3.8-flash"
)

# Validate API key
if not GEMINI_API_KEY:
    raise ValueError(
        "GEMINI_API_KEY is missing from environment variables"
    )

# Initialize Gemini client
client = genai.Client(
    api_key=GEMINI_API_KEY
)
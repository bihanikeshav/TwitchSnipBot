from setuptools import setup, find_packages

setup(
    name="snipbot",
    version="0.1.0",
    description="Detect Twitch stream highlights via chat analysis and auto-clip them",
    author="TwitchSnipBot",
    packages=find_packages(),
    python_requires=">=3.10",
    install_requires=[
        "torch>=2.0.0",
        "numpy>=1.24.0",
        "pyyaml>=6.0",
        "python-dotenv>=1.0.0",
        "emoji>=2.8.0",
        "aiohttp>=3.9.0",
        "scipy>=1.11.0",
        "streamlink>=6.0.0",
        "ffmpeg-python>=0.2.0",
        "onnx>=1.15.0",
        "fastapi>=0.104.0",
        "uvicorn>=0.24.0",
        "apscheduler>=3.10.0",
        "websockets>=12.0",
        "httpx>=0.25.0",
    ],
    extras_require={
        "youtube": [
            "google-api-python-client>=2.100.0",
            "google-auth-oauthlib>=1.1.0",
        ],
        "dev": [
            "pytest>=7.4.0",
        ],
    },
    entry_points={
        "console_scripts": [
            "snipbot=main:main",
        ],
    },
)

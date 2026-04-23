"""
WSGI entry point — used by PythonAnywhere and some other hosts.
PythonAnywhere WSGI config should import 'application' from this file.
"""
from app import app, init_db

init_db()
application = app

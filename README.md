on fronend, add .venv file
REACT_APP_GOOGLE_MAPS_API_KEY=
also run 
./sync.sh
npm start

on backend, run before start
export GOOGLE_API_KEY=
and uvicorn app:app --reload

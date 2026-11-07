# RamCalendar

구글 캘린더와 연동되는 윈도우 바탕화면 달력이에요.

## 설치
1. 오른쪽 **Releases**에서 `RamCalendar-Setup-버전.exe`를 받아 실행해요.
2. "Windows의 PC 보호"가 뜨면 **추가 정보 → 실행**을 눌러요.
3. 앱의 ⚙ 설정 → **구글 로그인**을 눌러요. "확인되지 않은 앱"이 뜨면 **고급 → (앱 이름)(으)로 이동**을 눌러요.

새 버전은 자동으로 업데이트돼요.

## 새 버전 내보내기 (관리자)
1. `package.json`의 `version`을 올려요. (예: 1.0.1)
2. Actions의 **설치 파일 만들기**를 실행해요.
3. Actions가 설치 파일을 만들어 Releases에 올리고, 설치한 사람들 앱이 자동 업데이트돼요.

처음 한 번: 저장소 **Settings → Secrets and variables → Actions**에
`GOOGLE_CLIENT_SECRET`을 등록해요. (클라이언트 ID는 워크플로에 들어 있어요)

- 소개 페이지: `docs/index.html` / 개인정보처리방침: `docs/privacy.html` (Settings → Pages → `docs` 폴더)

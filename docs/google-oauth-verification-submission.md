# Box Starry｜Google OAuth 正式驗證送審資料

## Branding

- App name: 繁星膠囊 Box Starry
- Homepage: https://box.starry.phd/about.html
- Privacy policy: https://box.starry.phd/privacy.html
- Terms of service: https://box.starry.phd/terms.html
- Authorized domain: starry.phd
- Production origin: https://box.starry.phd
- OAuth redirect URI: https://box.starry.phd/auth/youtube/callback

## Audience

- User type: External
- Publishing status: In production

## Requested YouTube scopes and justifications

### https://www.googleapis.com/auth/youtube.upload
Box Starry lets a signed-in user upload a video file directly to the user's own YouTube channel. The user explicitly selects the file, title, description, privacy setting and custom thumbnail before starting each upload. This scope is also used to set the custom thumbnail selected by the user for the uploaded video.

### https://www.googleapis.com/auth/youtube.readonly
Box Starry displays and synchronizes the authenticated user's own YouTube video library and playlists. This lets the user see their own videos inside Box Starry and select their own YouTube playlists during the upload workflow.

### https://www.googleapis.com/auth/youtube.force-ssl
Box Starry lets the user add a newly uploaded video to one or more YouTube playlists that the user explicitly selects in the upload screen. YouTube's playlistItems.insert endpoint requires a write-capable YouTube scope. Box Starry does not use this scope to delete the user's videos, comments, ratings or captions.

## Demo video checklist

1. Open https://box.starry.phd/about.html without being logged in.
2. Show the app description, privacy policy link and terms link.
3. Sign in to Starry ID and open the YouTube connection page.
4. Start “Connect my YouTube”.
5. On the Google consent screen, set the language to English and show the complete consent screen and every requested scope.
6. Approve access and return to Box Starry.
7. Open “My Videos” and show the app reading/synchronizing the user's own YouTube video list.
8. Open Upload Studio, select a video, title, privacy setting and custom thumbnail, then upload it to YouTube.
9. Select a YouTube playlist and show that the uploaded video is added to that explicitly selected playlist.
10. Open the YouTube connection page and show the disconnect/revoke control and the Box Starry data deletion control.
11. Show https://box.starry.phd/privacy.html and the Google API Services User Data Policy / Limited Use disclosure.

## Google Cloud steps

1. Verify ownership of `starry.phd` in Google Search Console using a Google account that is Owner or Editor of the Cloud project.
2. Google Auth Platform → Branding: fill in the app name, support email and the three URLs above.
3. Google Auth Platform → Audience: set External and publish the app to In production.
4. Google Auth Platform → Data Access: declare exactly the three YouTube scopes used in production.
5. Google Auth Platform → Clients: confirm the production redirect URI is exactly `https://box.starry.phd/auth/youtube/callback`.
6. Verification Center → Prepare for verification.
7. Paste the scope justifications above, upload/link the demo video, review all details, then Submit for Verification.

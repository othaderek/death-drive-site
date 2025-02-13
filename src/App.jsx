import ProfilePicture from './ProfilePicture';
function App() {

  return (
    <>
    <div className="background">
      <div className="container">
        <h1 className="company-name">Death Drive Pictures</h1>
        <ProfilePicture/>
        <div className="links">
          <a className="link" href="https://www.youtube.com/@DeathDrivePictures">work</a>
          <a className="link" href="https://www.instagram.com/deathdrivepictures">instagram</a>
          <a className="link" href="mailto:leah@deathdrivepictures.com">contact</a>
        </div>
      </div>
    </div>
    </>
  )
}

export default App

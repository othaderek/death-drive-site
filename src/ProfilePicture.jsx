import img from './assets/alien.png'

function ProfilePicture(){
  const imageUrl = img
  return <a href="https://www.instagram.com/deathdrivepictures"><img className="profile-picture" src={imageUrl}></img></a>
}

export default ProfilePicture
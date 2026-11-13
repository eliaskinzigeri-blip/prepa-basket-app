# Ajoute les fichiers Swift de native-ios/ à la cible « App » du projet Xcode généré par Capacitor,
# et remplace le contrôleur principal par PrepaBridgeViewController (qui enregistre le module PrepaVision).
require 'xcodeproj'
require 'fileutils'

proj = Xcodeproj::Project.open('ios/App/App.xcodeproj')
target = proj.targets.find { |t| t.name == 'App' } or abort('cible App introuvable')
group = proj.main_group['App'] or abort('groupe App introuvable')
Dir[File.join(__dir__, '*.swift')].each do |src|
  name = File.basename(src)
  FileUtils.cp(src, File.join('ios/App/App', name))
  next if group.files.any? { |f| f.path == name }
  ref = group.new_reference(name)
  target.add_file_references([ref])
  puts "ajouté : #{name}"
end
proj.save

sb = 'ios/App/App/Base.lproj/Main.storyboard'
xml = File.read(sb)
patched = xml.sub(/customClass="CAPBridgeViewController" customModule="Capacitor"/, 'customClass="PrepaBridgeViewController" customModule="App" customModuleProvider="target"')
abort('contrôleur Capacitor introuvable dans Main.storyboard') if patched == xml
File.write(sb, patched)
puts 'contrôleur principal : PrepaBridgeViewController'

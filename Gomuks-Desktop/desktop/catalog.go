package desktop

import (
	"os"
	"strings"
)

var desktopCatalogs = map[string]map[string]string{
	"it": {
		"Open Pinger": "Apri Pinger", "Search Messages": "Cerca messaggi", "Mark All as Read": "Segna tutti come letti",
		"Settings...": "Impostazioni...", "Check for Updates...": "Controlla aggiornamenti...", "Check for Updates": "Controlla aggiornamenti", "Quit Pinger": "Esci da Pinger",
		"About Pinger": "Informazioni su Pinger", "Settings Section": "Sezioni delle impostazioni", "Hide Pinger": "Nascondi Pinger",
		"Hide Others": "Nascondi le altre", "Unhide": "Mostra tutto", "File": "File", "New Private Model Chat": "Nuova chat con modello privato",
		"Switch Account": "Cambia account", "Add Account...": "Aggiungi account...", "Edit": "Modifica", "Messages": "Messaggi",
		"Quick Switch Rooms...": "Cambia stanza...", "Focus Room Search": "Cerca stanze", "Next Room": "Stanza successiva",
		"Previous Room": "Stanza precedente", "Next Needs-Reply Room": "Stanza successiva che richiede risposta",
		"Previous Needs-Reply Room": "Stanza precedente che richiede risposta", "Jump to Latest Messages": "Vai ai messaggi più recenti",
		"All Rooms": "Tutte le stanze", "Needs Reply": "Richiede risposta", "Unanswered": "Senza risposta", "Favorites": "Preferiti",
		"Archived": "Archiviate", "Private Model Chats": "Chat con modello privato", "Analyze Draft with Language Tutor": "Analizza la bozza con il tutor linguistico",
		"Room": "Stanza", "Mark Room as Answered": "Segna la stanza come risposta", "Add Room to Needs Reply": "Aggiungi a Richiede risposta",
		"Mark Room as Read": "Segna la stanza come letta", "Mark Room as Unread": "Segna la stanza come non letta",
		"Archive Room": "Archivia stanza", "Restore Room": "Ripristina stanza", "Add Room to Favorites": "Aggiungi ai preferiti",
		"Remove Room from Favorites": "Rimuovi dai preferiti", "Add Private Chat to All Rooms": "Mostra le chat private in Tutte le stanze",
		"Remove Private Chat from All Rooms": "Nascondi le chat private da Tutte le stanze", "Content Blur": "Sfocatura contenuti",
		"Hide Images and Videos": "Nascondi immagini e video", "Zoom In": "Ingrandisci", "Zoom Out": "Riduci",
		"Actual Size": "Dimensioni effettive", "Help": "Aiuto", "Keyboard Shortcuts": "Scorciatoie da tastiera",
		"Pinger Help": "Guida di Pinger", "Report an Issue...": "Segnala un problema...", "Project Repository...": "Repository del progetto...",
		"Release Notes...": "Note di rilascio...", "Project License...": "Licenza del progetto...", "No Accounts": "Nessun account",
		"New message": "Nuovo messaggio",
	},
	"es": {
		"Open Pinger": "Abrir Pinger", "Search Messages": "Buscar mensajes", "Mark All as Read": "Marcar todo como leído",
		"Settings...": "Configuración...", "Check for Updates...": "Buscar actualizaciones...", "Check for Updates": "Buscar actualizaciones", "Quit Pinger": "Salir de Pinger",
		"About Pinger": "Acerca de Pinger", "Settings Section": "Secciones de configuración", "Hide Pinger": "Ocultar Pinger",
		"Hide Others": "Ocultar las demás", "Unhide": "Mostrar todo", "File": "Archivo", "New Private Model Chat": "Nuevo chat con modelo privado",
		"Switch Account": "Cambiar cuenta", "Add Account...": "Añadir cuenta...", "Edit": "Editar", "Messages": "Mensajes",
		"Quick Switch Rooms...": "Cambiar de sala...", "Focus Room Search": "Buscar salas", "Next Room": "Sala siguiente",
		"Previous Room": "Sala anterior", "Next Needs-Reply Room": "Siguiente sala que requiere respuesta",
		"Previous Needs-Reply Room": "Sala anterior que requiere respuesta", "Jump to Latest Messages": "Ir a los mensajes más recientes",
		"All Rooms": "Todas las salas", "Needs Reply": "Requieren respuesta", "Unanswered": "Sin responder", "Favorites": "Favoritos",
		"Archived": "Archivadas", "Private Model Chats": "Chats con modelo privado", "Analyze Draft with Language Tutor": "Analizar borrador con el tutor de idiomas",
		"Room": "Sala", "Mark Room as Answered": "Marcar sala como respondida", "Add Room to Needs Reply": "Añadir a Requieren respuesta",
		"Mark Room as Read": "Marcar sala como leída", "Mark Room as Unread": "Marcar sala como no leída",
		"Archive Room": "Archivar sala", "Restore Room": "Restaurar sala", "Add Room to Favorites": "Añadir a favoritos",
		"Remove Room from Favorites": "Quitar de favoritos", "Add Private Chat to All Rooms": "Mostrar chats privados en Todas las salas",
		"Remove Private Chat from All Rooms": "Ocultar chats privados de Todas las salas", "Content Blur": "Desenfoque del contenido",
		"Hide Images and Videos": "Ocultar imágenes y vídeos", "Zoom In": "Ampliar", "Zoom Out": "Reducir",
		"Actual Size": "Tamaño real", "Help": "Ayuda", "Keyboard Shortcuts": "Atajos de teclado",
		"Pinger Help": "Ayuda de Pinger", "Report an Issue...": "Informar de un problema...", "Project Repository...": "Repositorio del proyecto...",
		"Release Notes...": "Notas de la versión...", "Project License...": "Licencia del proyecto...", "No Accounts": "No hay cuentas",
		"New message": "Mensaje nuevo",
	},
	"de": {
		"Open Pinger": "Pinger öffnen", "Search Messages": "Nachrichten suchen", "Mark All as Read": "Alle als gelesen markieren",
		"Settings...": "Einstellungen...", "Check for Updates...": "Nach Updates suchen...", "Check for Updates": "Nach Updates suchen", "Quit Pinger": "Pinger beenden",
		"About Pinger": "Über Pinger", "Settings Section": "Einstellungsbereiche", "Hide Pinger": "Pinger ausblenden",
		"Hide Others": "Andere ausblenden", "Unhide": "Alle einblenden", "File": "Datei", "New Private Model Chat": "Neuer privater Modell-Chat",
		"Switch Account": "Konto wechseln", "Add Account...": "Konto hinzufügen...", "Edit": "Bearbeiten", "Messages": "Nachrichten",
		"Quick Switch Rooms...": "Raum wechseln...", "Focus Room Search": "Raumsuche öffnen", "Next Room": "Nächster Raum",
		"Previous Room": "Vorheriger Raum", "Next Needs-Reply Room": "Nächster Raum mit Antwortbedarf",
		"Previous Needs-Reply Room": "Vorheriger Raum mit Antwortbedarf", "Jump to Latest Messages": "Zu den neuesten Nachrichten springen",
		"All Rooms": "Alle Räume", "Needs Reply": "Antwort erforderlich", "Unanswered": "Unbeantwortet", "Favorites": "Favoriten",
		"Archived": "Archiviert", "Private Model Chats": "Private Modell-Chats", "Analyze Draft with Language Tutor": "Entwurf mit Sprachcoach analysieren",
		"Room": "Raum", "Mark Room as Answered": "Raum als beantwortet markieren", "Add Room to Needs Reply": "Zu Antwort erforderlich hinzufügen",
		"Mark Room as Read": "Raum als gelesen markieren", "Mark Room as Unread": "Raum als ungelesen markieren",
		"Archive Room": "Raum archivieren", "Restore Room": "Raum wiederherstellen", "Add Room to Favorites": "Zu Favoriten hinzufügen",
		"Remove Room from Favorites": "Aus Favoriten entfernen", "Add Private Chat to All Rooms": "Private Chats unter Alle Räume anzeigen",
		"Remove Private Chat from All Rooms": "Private Chats aus Alle Räume ausblenden", "Content Blur": "Inhalte weichzeichnen",
		"Hide Images and Videos": "Bilder und Videos ausblenden", "Zoom In": "Vergrößern", "Zoom Out": "Verkleinern",
		"Actual Size": "Originalgröße", "Help": "Hilfe", "Keyboard Shortcuts": "Tastenkürzel",
		"Pinger Help": "Pinger-Hilfe", "Report an Issue...": "Problem melden...", "Project Repository...": "Projekt-Repository...",
		"Release Notes...": "Versionshinweise...", "Project License...": "Projektlizenz...", "No Accounts": "Keine Konten",
		"New message": "Neue Nachricht",
	},
	"fr": {
		"Open Pinger": "Ouvrir Pinger", "Search Messages": "Rechercher des messages", "Mark All as Read": "Tout marquer comme lu",
		"Settings...": "Paramètres...", "Check for Updates...": "Rechercher des mises à jour...", "Check for Updates": "Rechercher des mises à jour", "Quit Pinger": "Quitter Pinger",
		"About Pinger": "À propos de Pinger", "Settings Section": "Sections des paramètres", "Hide Pinger": "Masquer Pinger",
		"Hide Others": "Masquer les autres", "Unhide": "Tout afficher", "File": "Fichier", "New Private Model Chat": "Nouvelle conversation avec modèle privé",
		"Switch Account": "Changer de compte", "Add Account...": "Ajouter un compte...", "Edit": "Modifier", "Messages": "Messages",
		"Quick Switch Rooms...": "Changer de salon...", "Focus Room Search": "Rechercher des salons", "Next Room": "Salon suivant",
		"Previous Room": "Salon précédent", "Next Needs-Reply Room": "Salon suivant nécessitant une réponse",
		"Previous Needs-Reply Room": "Salon précédent nécessitant une réponse", "Jump to Latest Messages": "Aller aux messages les plus récents",
		"All Rooms": "Tous les salons", "Needs Reply": "Réponse requise", "Unanswered": "Sans réponse", "Favorites": "Favoris",
		"Archived": "Archivés", "Private Model Chats": "Conversations avec modèle privé", "Analyze Draft with Language Tutor": "Analyser le brouillon avec le tuteur linguistique",
		"Room": "Salon", "Mark Room as Answered": "Marquer le salon comme traité", "Add Room to Needs Reply": "Ajouter à Réponse requise",
		"Mark Room as Read": "Marquer le salon comme lu", "Mark Room as Unread": "Marquer le salon comme non lu",
		"Archive Room": "Archiver le salon", "Restore Room": "Restaurer le salon", "Add Room to Favorites": "Ajouter aux favoris",
		"Remove Room from Favorites": "Retirer des favoris", "Add Private Chat to All Rooms": "Afficher les conversations privées dans Tous les salons",
		"Remove Private Chat from All Rooms": "Masquer les conversations privées de Tous les salons", "Content Blur": "Flou du contenu",
		"Hide Images and Videos": "Masquer les images et vidéos", "Zoom In": "Agrandir", "Zoom Out": "Réduire",
		"Actual Size": "Taille réelle", "Help": "Aide", "Keyboard Shortcuts": "Raccourcis clavier",
		"Pinger Help": "Aide de Pinger", "Report an Issue...": "Signaler un problème...", "Project Repository...": "Dépôt du projet...",
		"Release Notes...": "Notes de version...", "Project License...": "Licence du projet...", "No Accounts": "Aucun compte",
		"New message": "Nouveau message",
	},
}

func localizedUIString(language, english string) string {
	language = normalizeUILanguage(language)
	if translated := desktopCatalogs[language][english]; translated != "" {
		return translated
	}
	return english
}

func normalizeUILanguage(language string) string {
	if language == "" || strings.EqualFold(language, "system") {
		for _, key := range []string{"LC_ALL", "LC_MESSAGES", "LANG"} {
			if value := os.Getenv(key); value != "" {
				language = value
				break
			}
		}
	}
	language = strings.ToLower(strings.ReplaceAll(language, "_", "-"))
	language = strings.SplitN(language, ".", 2)[0]
	language = strings.SplitN(language, "-", 2)[0]
	if _, ok := desktopCatalogs[language]; ok {
		return language
	}
	return "en"
}
